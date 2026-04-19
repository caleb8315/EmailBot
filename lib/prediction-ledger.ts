import { createClient } from '@supabase/supabase-js';
import type { Prediction } from './types';
import { recordPatternOutcomeFromResolution } from './pattern-calibration';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

// ── Brier score: measures calibration (0 = perfect, 1 = worst) ──────────

export function calculateBrierScore(
  predictedProbability: number,
  outcome: boolean,
): number {
  return Math.pow(predictedProbability - (outcome ? 1 : 0), 2);
}

// ── Create a new prediction ─────────────────────────────────────────────

export async function createPrediction(
  predictor: 'jeff' | 'user',
  statement: string,
  confidence: number,
  opts: {
    resolve_by?: string;
    tags?: string[];
    region?: string;
    related_belief_id?: string;
  } = {},
): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('predictions')
    .insert({
      predictor,
      statement,
      confidence_at_prediction: Math.max(0.02, Math.min(0.98, confidence)),
      resolve_by: opts.resolve_by || null,
      tags: opts.tags || [],
      region: opts.region || null,
      related_belief_id: opts.related_belief_id || null,
      confidence_history: [{ timestamp: new Date().toISOString(), confidence, reason: 'initial prediction' }],
    })
    .select('id')
    .single();

  if (error) {
    console.error('[prediction-ledger] Create failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

// ── Resolve a prediction ────────────────────────────────────────────────

export async function resolvePrediction(
  id: string,
  outcome: 'correct' | 'incorrect' | 'partial' | 'unresolvable',
  notes?: string,
): Promise<void> {
  const sb = getSupabase();

  const { data: pred } = await sb
    .from('predictions')
    .select('*')
    .eq('id', id)
    .single();

  if (!pred) return;

  const isCorrect = outcome === 'correct';
  const brierScore = outcome === 'unresolvable'
    ? null
    : calculateBrierScore(pred.confidence_at_prediction, isCorrect);

  await sb
    .from('predictions')
    .update({
      resolved_at: new Date().toISOString(),
      outcome,
      outcome_notes: notes || null,
      brier_score: brierScore,
    })
    .eq('id', id);

  // Update user profile calibration
  if (brierScore !== null) {
    await updateCalibration(pred.predictor, brierScore, pred.tags, pred.region);
  }

  if (pred.predictor === 'jeff') {
    await recordPatternOutcomeFromResolution(pred.tags as string[], outcome);
  }
}

// ── Weekly check for resolvable predictions ─────────────────────────────

export async function evaluateResolvablePredictions(): Promise<{
  checked: number;
  resolved: number;
}> {
  const sb = getSupabase();
  const now = new Date().toISOString();

  const { data: overdue } = await sb
    .from('predictions')
    .select('*')
    .is('resolved_at', null)
    .lte('resolve_by', now);

  if (!overdue) return { checked: 0, resolved: 0 };

  // Predictions that pass their resolve_by date are flagged for manual review
  // Auto-resolution would need an LLM call — flagging instead
  for (const pred of overdue) {
    await sb
      .from('predictions')
      .update({
        confidence_history: [
          ...(pred.confidence_history || []),
          { timestamp: now, confidence: pred.confidence_at_prediction, reason: 'resolve_by date passed — awaiting manual resolution' },
        ],
      })
      .eq('id', pred.id);
  }

  console.log(`[prediction-ledger] ${overdue.length} predictions past resolve_by date`);
  return { checked: overdue.length, resolved: 0 };
}

// ── Calibration tracking ────────────────────────────────────────────────

async function updateCalibration(
  predictor: string,
  brierScore: number,
  tags: string[],
  region?: string,
): Promise<void> {
  const sb = getSupabase();

  const { data: profiles } = await sb
    .from('user_profile')
    .select('*')
    .limit(1);

  const profile = profiles?.[0];
  if (!profile) {
    await sb.from('user_profile').insert({
      total_predictions: 1,
      correct_predictions: brierScore < 0.25 ? 1 : 0,
      calibration_score: 1 - brierScore,
      calibration_by_region: region ? { [region]: 1 - brierScore } : {},
      calibration_by_topic: {},
    });
    return;
  }

  const newTotal = (profile.total_predictions || 0) + 1;
  const newCorrect = (profile.correct_predictions || 0) + (brierScore < 0.25 ? 1 : 0);
  const newCalibration = newCorrect / newTotal;

  const regionScores = { ...(profile.calibration_by_region || {}) };
  if (region) {
    const existing = regionScores[region];
    regionScores[region] = existing ? (existing + (1 - brierScore)) / 2 : 1 - brierScore;
  }

  const topicScores = { ...(profile.calibration_by_topic || {}) };
  for (const tag of tags.slice(0, 3)) {
    const existing = topicScores[tag];
    topicScores[tag] = existing ? (existing + (1 - brierScore)) / 2 : 1 - brierScore;
  }

  await sb
    .from('user_profile')
    .update({
      total_predictions: newTotal,
      correct_predictions: newCorrect,
      calibration_score: newCalibration,
      calibration_by_region: regionScores,
      calibration_by_topic: topicScores,
      last_updated: new Date().toISOString(),
    })
    .eq('id', profile.id);
}

// ── Read helpers ────────────────────────────────────────────────────────

export async function getUserCalibrationReport(): Promise<{
  overall_brier_score: number;
  by_region: Record<string, number>;
  by_topic: Record<string, number>;
  total_predictions: number;
  correct_predictions: number;
  jeff_vs_user: { jeff_avg: number; user_avg: number };
}> {
  const sb = getSupabase();

  const { data: profile } = await sb
    .from('user_profile')
    .select('*')
    .limit(1)
    .single();

  const { data: resolved } = await sb
    .from('predictions')
    .select('predictor, brier_score')
    .not('brier_score', 'is', null);

  let jeffAvg = 0;
  let userAvg = 0;
  let jeffCount = 0;
  let userCount = 0;

  for (const p of resolved || []) {
    if (p.predictor === 'jeff') { jeffAvg += p.brier_score; jeffCount++; }
    else { userAvg += p.brier_score; userCount++; }
  }

  return {
    overall_brier_score: profile?.calibration_score ? 1 - profile.calibration_score : 0.5,
    by_region: profile?.calibration_by_region || {},
    by_topic: profile?.calibration_by_topic || {},
    total_predictions: profile?.total_predictions || 0,
    correct_predictions: profile?.correct_predictions || 0,
    jeff_vs_user: {
      jeff_avg: jeffCount > 0 ? jeffAvg / jeffCount : 0.5,
      user_avg: userCount > 0 ? userAvg / userCount : 0.5,
    },
  };
}

export async function getActivePredictions(): Promise<Prediction[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('predictions')
    .select('*')
    .is('resolved_at', null)
    .order('made_at', { ascending: false });
  return (data || []) as Prediction[];
}

export async function getResolvedPredictions(limit = 50): Promise<Prediction[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('predictions')
    .select('*')
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(limit);
  return (data || []) as Prediction[];
}

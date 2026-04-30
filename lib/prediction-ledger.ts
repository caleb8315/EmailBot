import { createClient } from '@supabase/supabase-js';
import type { Prediction } from './types';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

// ── Proper scoring rules ────────────────────────────────────────────────
// Brier (0 perfect, 1 worst) and log loss (0 perfect, ∞ worst). Tracking
// both lets us detect a forecaster who is "miscalibrated but lucky" versus
// one who is "well-calibrated but unsure".

export function calculateBrierScore(
  predictedProbability: number,
  outcome: boolean,
): number {
  return Math.pow(predictedProbability - (outcome ? 1 : 0), 2);
}

const LOG_EPS = 1e-6;

export function calculateLogLoss(
  predictedProbability: number,
  outcome: boolean,
): number {
  const p = Math.max(LOG_EPS, Math.min(1 - LOG_EPS, predictedProbability));
  return outcome ? -Math.log(p) : -Math.log(1 - p);
}

/** Bin a probability into a 10% reliability bucket (0..9). */
export function calibrationBin(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(9, Math.floor(Math.max(0, Math.min(0.9999, p)) * 10)));
}

// ── Create a new prediction ─────────────────────────────────────────────

export interface ForecastDecomposition {
  /** What is the historical base rate for this kind of event? */
  base_rate?: number;
  /** Plain-English mechanism: why we think this happens. */
  mechanism?: string;
  /** Concrete signals that would update us up / down. */
  key_signals?: string[];
  /** What observation would falsify the forecast. */
  falsifier?: string;
  /** Optional: lower / upper bound from Monte-Carlo or ensemble spread. */
  ci_low?: number;
  ci_high?: number;
}

export interface CreatePredictionOpts {
  resolve_by?: string;
  tags?: string[];
  region?: string;
  related_belief_id?: string;
  decomposition?: ForecastDecomposition;
  ensemble?: Record<string, unknown>;
  reasoning_trace_id?: string;
}

export async function createPrediction(
  predictor: 'jeff' | 'user',
  statement: string,
  confidence: number,
  opts: CreatePredictionOpts = {},
): Promise<string | null> {
  const sb = getSupabase();
  const clamped = Math.max(0.02, Math.min(0.98, confidence));
  const { data, error } = await sb
    .from('predictions')
    .insert({
      predictor,
      statement,
      confidence_at_prediction: clamped,
      resolve_by: opts.resolve_by || null,
      tags: opts.tags || [],
      region: opts.region || null,
      related_belief_id: opts.related_belief_id || null,
      confidence_history: [{ timestamp: new Date().toISOString(), confidence: clamped, reason: 'initial prediction' }],
      calibration_bin: calibrationBin(clamped),
      decomposition: opts.decomposition || {},
      ensemble: opts.ensemble || {},
      reasoning_trace_id: opts.reasoning_trace_id || null,
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
  opts: { auto_resolution_sources?: unknown[] } = {},
): Promise<void> {
  const sb = getSupabase();

  const { data: pred, error: fetchError } = await sb
    .from('predictions')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !pred) {
    throw new Error(`Prediction not found: ${id}`);
  }

  const p = pred.confidence_at_prediction as number;

  // Map outcome to a numeric truth value. 'partial' = 0.5 so that brier/log-loss
  // still meaningfully penalize confident wrong calls without throwing them away.
  let truth: number | null;
  switch (outcome) {
    case 'correct': truth = 1; break;
    case 'incorrect': truth = 0; break;
    case 'partial': truth = 0.5; break;
    default: truth = null;
  }

  const brierScore = truth == null ? null : Math.pow(p - truth, 2);
  const logLoss = truth == null
    ? null
    : -(truth * Math.log(Math.max(LOG_EPS, Math.min(1 - LOG_EPS, p))) +
        (1 - truth) * Math.log(Math.max(LOG_EPS, Math.min(1 - LOG_EPS, 1 - p))));

  const { error: updateError } = await sb
    .from('predictions')
    .update({
      resolved_at: new Date().toISOString(),
      outcome,
      outcome_notes: notes || null,
      brier_score: brierScore,
      log_loss: logLoss,
      calibration_bin: calibrationBin(p),
      auto_resolution_sources: opts.auto_resolution_sources ?? [],
    })
    .eq('id', id);

  if (updateError) {
    throw new Error(`Failed to update prediction: ${updateError.message}`);
  }

  if (brierScore !== null && truth !== null) {
    await updateCalibration({
      predictor: pred.predictor,
      predicted: p,
      observed: truth,
      brier: brierScore,
      logLoss: logLoss ?? 0,
      tags: pred.tags || [],
      region: pred.region || undefined,
    });
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
// We maintain three views of calibration in the DB:
//   1. user_profile aggregate (overall brier/log-loss + curve summary)
//   2. prediction_calibration_bins per (predictor, bin, topic, region)
//      — these power true reliability diagrams
//   3. The bin column on each prediction so we can recompute on demand
// All updates are streaming (Welford-style means) so they cost O(1) per
// resolution rather than O(n) over the full ledger.

interface CalibUpdateArgs {
  predictor: string;
  predicted: number;
  observed: number;          // 0, 0.5, or 1
  brier: number;
  logLoss: number;
  tags: string[];
  region?: string;
}

async function bumpBin(
  sb: ReturnType<typeof getSupabase>,
  args: { predictor: string; bin: number; topic: string | null; region: string | null;
          predicted: number; observed: number; brier: number; logLoss: number },
): Promise<void> {
  const { data } = await sb
    .from('prediction_calibration_bins')
    .select('*')
    .eq('predictor', args.predictor)
    .eq('bin', args.bin)
    .eq('topic', args.topic ?? '')
    .eq('region', args.region ?? '')
    .maybeSingle();

  const prev = data
    ? {
        n: (data.n_predictions as number) ?? 0,
        meanPred: (data.mean_predicted as number) ?? 0,
        meanObs: (data.mean_observed as number) ?? 0,
        brierAvg: (data.brier_avg as number | null) ?? 0,
        logAvg: (data.log_loss_avg as number | null) ?? 0,
      }
    : null;

  const n = (prev?.n ?? 0) + 1;
  const meanPred = prev ? prev.meanPred + (args.predicted - prev.meanPred) / n : args.predicted;
  const meanObs = prev ? prev.meanObs + (args.observed - prev.meanObs) / n : args.observed;
  const brierAvg = prev ? prev.brierAvg + (args.brier - prev.brierAvg) / n : args.brier;
  const logAvg = prev ? prev.logAvg + (args.logLoss - prev.logAvg) / n : args.logLoss;

  await sb.from('prediction_calibration_bins').upsert(
    {
      predictor: args.predictor,
      bin: args.bin,
      topic: args.topic ?? '',
      region: args.region ?? '',
      n_predictions: n,
      mean_predicted: meanPred,
      mean_observed: meanObs,
      brier_avg: brierAvg,
      log_loss_avg: logAvg,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'predictor,bin,topic,region' },
  );
}

async function updateCalibration(args: CalibUpdateArgs): Promise<void> {
  const sb = getSupabase();
  const bin = calibrationBin(args.predicted);

  // 1. bin updates (overall, plus per-region, plus per top tag)
  await bumpBin(sb, {
    predictor: args.predictor,
    bin,
    topic: null,
    region: null,
    predicted: args.predicted,
    observed: args.observed,
    brier: args.brier,
    logLoss: args.logLoss,
  });
  if (args.region) {
    await bumpBin(sb, {
      predictor: args.predictor,
      bin,
      topic: null,
      region: args.region,
      predicted: args.predicted,
      observed: args.observed,
      brier: args.brier,
      logLoss: args.logLoss,
    });
  }
  for (const tag of args.tags.slice(0, 3)) {
    await bumpBin(sb, {
      predictor: args.predictor,
      bin,
      topic: tag,
      region: null,
      predicted: args.predicted,
      observed: args.observed,
      brier: args.brier,
      logLoss: args.logLoss,
    });
  }

  // 2. profile aggregate
  const { data: profiles } = await sb
    .from('user_profile')
    .select('*')
    .limit(1);

  const profile = profiles?.[0];
  const isCorrect = args.observed >= 0.5 ? 1 : 0;

  if (!profile) {
    await sb.from('user_profile').insert({
      total_predictions: 1,
      correct_predictions: isCorrect,
      resolved_count: 1,
      brier_avg: args.brier,
      log_loss_avg: args.logLoss,
      calibration_score: 1 - args.brier,
      calibration_by_region: args.region ? { [args.region]: 1 - args.brier } : {},
      calibration_by_topic: {},
    });
    return;
  }

  const prevResolved = (profile.resolved_count as number) ?? (profile.total_predictions as number) ?? 0;
  const n = prevResolved + 1;
  const prevBrier = (profile.brier_avg as number | null) ?? 0;
  const prevLog = (profile.log_loss_avg as number | null) ?? 0;
  const newBrier = prevBrier + (args.brier - prevBrier) / n;
  const newLog = prevLog + (args.logLoss - prevLog) / n;

  const regionScores = { ...(profile.calibration_by_region || {}) } as Record<string, number>;
  if (args.region) {
    const existing = regionScores[args.region];
    regionScores[args.region] = existing != null ? (existing + (1 - args.brier)) / 2 : 1 - args.brier;
  }

  const topicScores = { ...(profile.calibration_by_topic || {}) } as Record<string, number>;
  for (const tag of args.tags.slice(0, 3)) {
    const existing = topicScores[tag];
    topicScores[tag] = existing != null ? (existing + (1 - args.brier)) / 2 : 1 - args.brier;
  }

  // refresh full reliability curve summary
  const { data: bins } = await sb
    .from('prediction_calibration_bins')
    .select('bin, mean_predicted, mean_observed, n_predictions')
    .eq('predictor', args.predictor)
    .is('topic', null)
    .is('region', null);

  const curve = (bins || []).map((b) => ({
    bin: b.bin as number,
    n: b.n_predictions as number,
    predicted: b.mean_predicted as number,
    observed: b.mean_observed as number,
  }));

  await sb
    .from('user_profile')
    .update({
      total_predictions: ((profile.total_predictions as number) ?? 0) + 1,
      correct_predictions: ((profile.correct_predictions as number) ?? 0) + isCorrect,
      resolved_count: n,
      brier_avg: newBrier,
      log_loss_avg: newLog,
      calibration_score: 1 - newBrier,
      calibration_by_region: regionScores,
      calibration_by_topic: topicScores,
      calibration_curve: curve,
      last_updated: new Date().toISOString(),
    })
    .eq('id', profile.id);
}

// ── Read helpers ────────────────────────────────────────────────────────

export interface CalibrationReport {
  overall_brier_score: number;
  overall_log_loss: number;
  by_region: Record<string, number>;
  by_topic: Record<string, number>;
  total_predictions: number;
  correct_predictions: number;
  resolved_count: number;
  reliability_curve: { bin: number; n: number; predicted: number; observed: number }[];
  jeff_vs_user: {
    jeff_avg_brier: number;
    user_avg_brier: number;
    jeff_avg_log_loss: number;
    user_avg_log_loss: number;
  };
}

export async function getUserCalibrationReport(): Promise<CalibrationReport> {
  const sb = getSupabase();

  const { data: profile } = await sb
    .from('user_profile')
    .select('*')
    .limit(1)
    .single();

  const { data: resolved } = await sb
    .from('predictions')
    .select('predictor, brier_score, log_loss')
    .not('brier_score', 'is', null);

  let jeffBrier = 0; let jeffLog = 0; let jeffCount = 0;
  let userBrier = 0; let userLog = 0; let userCount = 0;

  for (const p of resolved || []) {
    const b = p.brier_score as number | null;
    const l = p.log_loss as number | null;
    if (b == null) continue;
    if (p.predictor === 'jeff') {
      jeffBrier += b;
      if (l != null) jeffLog += l;
      jeffCount++;
    } else {
      userBrier += b;
      if (l != null) userLog += l;
      userCount++;
    }
  }

  return {
    overall_brier_score: (profile?.brier_avg as number | null) ?? (profile?.calibration_score ? 1 - (profile.calibration_score as number) : 0.25),
    overall_log_loss: (profile?.log_loss_avg as number | null) ?? 0.5,
    by_region: (profile?.calibration_by_region as Record<string, number>) || {},
    by_topic: (profile?.calibration_by_topic as Record<string, number>) || {},
    total_predictions: (profile?.total_predictions as number) || 0,
    correct_predictions: (profile?.correct_predictions as number) || 0,
    resolved_count: (profile?.resolved_count as number) ?? (resolved?.length ?? 0),
    reliability_curve: (profile?.calibration_curve as { bin: number; n: number; predicted: number; observed: number }[]) || [],
    jeff_vs_user: {
      jeff_avg_brier: jeffCount > 0 ? jeffBrier / jeffCount : 0.25,
      user_avg_brier: userCount > 0 ? userBrier / userCount : 0.25,
      jeff_avg_log_loss: jeffCount > 0 ? jeffLog / jeffCount : 0.5,
      user_avg_log_loss: userCount > 0 ? userLog / userCount : 0.5,
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

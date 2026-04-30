import { createClient } from '@supabase/supabase-js';
import type { Hypothesis, IntelEvent, ConfidenceEntry } from './types';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

// ── Bayesian update for hypotheses ──────────────────────────────────────

function bayesUpdate(prior: number, supports: boolean, strength: number): number {
  // strength 0.1–0.9: how diagnostic is this signal?
  const lr = supports
    ? 1 + strength * 4       // supporting: LR 1.1–4.6
    : 1 / (1 + strength * 2); // undermining: LR 0.33–0.91

  const posterior = (prior * lr) / (prior * lr + (1 - prior));
  return Math.max(0.02, Math.min(0.98, posterior));
}

function assessEventRelevance(event: IntelEvent, hypothesis: Hypothesis): number {
  const hText = `${hypothesis.title} ${(hypothesis.tags ?? []).join(' ')} ${hypothesis.region || ''}`.toLowerCase();
  const eText = `${event.title} ${event.summary} ${(event.tags ?? []).join(' ')}`.toLowerCase();

  const hTokens = hText.split(/\s+/).filter(t => t.length > 3);
  let matchScore = 0;
  for (const token of hTokens) {
    if (eText.includes(token)) matchScore++;
  }

  if (matchScore < 2) return 0;

  // Positive = supporting, negative = undermining
  const conflictTypes = ['conflict', 'airstrike', 'military_flight_isr', 'vessel_dark', 'doomsday_plane'];
  const isConflictEvent = conflictTypes.includes(event.type);
  const isEscalationHypothesis = /escalat|operation|provocation|attack|strike/.test(hypothesis.title.toLowerCase());

  if (isEscalationHypothesis && isConflictEvent) return 0.3 + (event.severity / 200);
  if (isEscalationHypothesis && !isConflictEvent) return -0.1;

  return event.severity > 50 ? 0.2 : -0.1;
}

// ── Update all hypotheses against new events ────────────────────────────

export async function updateAllHypotheses(newEvents: IntelEvent[]): Promise<number> {
  const sb = getSupabase();
  let updated = 0;

  const { data: hypotheses } = await sb
    .from('hypotheses')
    .select('*')
    .eq('status', 'active');

  if (!hypotheses) return 0;

  for (const raw of hypotheses) {
    const h = raw as Hypothesis;

    for (const event of newEvents) {
      const relevance = assessEventRelevance(event, h);
      if (relevance === 0) continue;

      const supports = relevance > 0;
      const strength = Math.abs(relevance);
      const newConfidence = bayesUpdate(h.confidence, supports, strength);
      const change = newConfidence - h.confidence;

      const historyEntry: ConfidenceEntry = {
        timestamp: new Date().toISOString(),
        confidence: newConfidence,
        reason: `${event.type} from ${event.source}: ${supports ? '+' : '-'} ${event.title.slice(0, 80)}`,
        event_id: event.id,
      };

      const updatedHistory = [...(h.confidence_history || []), historyEntry].slice(-50);
      const updatedSupporting = supports
        ? [...(h.supporting_signals || []), event.id].filter(Boolean).slice(-30)
        : h.supporting_signals;
      const updatedUndermining = !supports
        ? [...(h.undermining_signals || []), event.id].filter(Boolean).slice(-30)
        : h.undermining_signals;

      await sb
        .from('hypotheses')
        .update({
          confidence: newConfidence,
          confidence_history: updatedHistory,
          supporting_signals: updatedSupporting,
          undermining_signals: updatedUndermining,
          last_updated: new Date().toISOString(),
        })
        .eq('id', h.id);

      h.confidence = newConfidence;
      updated++;
    }

    // Auto-reject hypotheses that drop below 5%
    if (h.confidence < 0.05) {
      await sb.from('hypotheses').update({ status: 'rejected' }).eq('id', h.id);
    }
  }

  console.log(`[hypothesis-board] Updated ${updated} hypotheses`);
  return updated;
}

// ── Create hypothesis (typically from pattern match) ────────────────────

export async function createHypothesis(
  title: string,
  initialConfidence: number = 0.3,
  opts: { region?: string; tags?: string[]; trigger_event_id?: string } = {},
): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('hypotheses')
    .insert({
      title,
      confidence: initialConfidence,
      prior_confidence: initialConfidence,
      confidence_history: [{ timestamp: new Date().toISOString(), confidence: initialConfidence, reason: 'hypothesis formed' }],
      region: opts.region || null,
      tags: opts.tags || [],
      trigger_event_id: opts.trigger_event_id || null,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[hypothesis-board] Create failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function getActiveHypotheses(): Promise<Hypothesis[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('hypotheses')
    .select('*')
    .eq('status', 'active')
    .order('confidence', { ascending: false });
  return (data || []) as Hypothesis[];
}

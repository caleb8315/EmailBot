import { createClient } from '@supabase/supabase-js';
import type { Hypothesis, IntelEvent, ConfidenceEntry, PatternMatch } from './types';

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

/**
 * Shannon-style source diversity normalized to [0,1].
 * Hypotheses backed by 5 distinct sources should be trusted much more
 * than hypotheses backed by 5 events from the same source.
 */
export function computeSourceDiversity(sources: string[]): number {
  const counts = new Map<string, number>();
  for (const s of sources) counts.set(s, (counts.get(s) || 0) + 1);
  if (counts.size <= 1) return 0;
  const total = sources.length;
  let entropy = 0;
  for (const v of counts.values()) {
    const p = v / total;
    entropy -= p * Math.log2(p);
  }
  // normalize to [0,1] by dividing by log2(N) where N = number of unique sources
  return Math.min(1, entropy / Math.log2(counts.size));
}

function logOdds(p: number): number {
  const clamped = Math.max(0.01, Math.min(0.99, p));
  return Math.log(clamped / (1 - clamped));
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

      // recompute source diversity from the events we have actually
      // observed for this hypothesis. We use the source field of the
      // most recent triggering events; fall back to event source.
      const eventSources = newEvents
        .filter((e) => (updatedSupporting || []).includes(e.id || ''))
        .map((e) => e.source);
      const diversity = computeSourceDiversity(eventSources);

      await sb
        .from('hypotheses')
        .update({
          confidence: newConfidence,
          confidence_history: updatedHistory,
          supporting_signals: updatedSupporting,
          undermining_signals: updatedUndermining,
          source_diversity: diversity,
          log_odds: logOdds(newConfidence),
          last_updated: new Date().toISOString(),
        })
        .eq('id', h.id);

      h.confidence = newConfidence;
      updated++;
    }

    // Auto-reject hypotheses that drop below 5%, auto-confirm above 90%
    if (h.confidence < 0.05) {
      await sb.from('hypotheses').update({ status: 'rejected' }).eq('id', h.id);
    } else if (h.confidence > 0.9 && (h.supporting_signals?.length ?? 0) >= 4) {
      await sb.from('hypotheses').update({ status: 'confirmed' }).eq('id', h.id);
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

// ── Hypothesis creation from pattern matches ────────────────────────────
// Until now `createHypothesis` had no callers, so the hypothesis board
// only held seeded entries and never auto-formed from real signals.
// `createHypothesisFromPattern` fixes that AND spawns a paired *null*
// hypothesis ("the benign explanation") so future events update both
// sides — making the board genuinely competitive instead of a one-sided
// confirmation engine.

const NULL_HYPOTHESIS_TEMPLATES: Record<string, string> = {
  pre_operational_posture: 'Activity is a routine drill / training rotation, not preparation for a real operation in {region}',
  internet_blackout_conflict: 'Internet disruption in {region} is technical (cable cut / weather / outage), unrelated to military activity',
  sanctions_evasion_detected: 'Vessel-dark behavior in {region} reflects equipment failure or innocuous AIS gaps, not sanctions evasion',
  prediction_market_insider: 'Prediction-market move is liquidity / single-trader noise, not a leading indicator of news',
  doomsday_activation: 'E-6/E-4 / nuclear-command flight is scheduled training, not DEFCON elevation',
  io_campaign_detected: 'Narrative cluster is organic viral pickup of one source, not coordinated IO',
  hospital_ship_deployment: 'Hospital ship movement is humanitarian rotation or maintenance, not pre-conflict positioning',
  procurement_surge: 'Procurement surge is end-of-fiscal-year contracting noise, not operational preparation',
};

/**
 * Spawn a primary hypothesis (the pattern's hypothesisTemplate) and a
 * competing null hypothesis. They are linked via competing_hypothesis_ids
 * so the dashboard / digests can show them side by side.
 *
 * Returns { primary_id, null_id } or { primary_id: null, null_id: null }
 * if creation failed or an active primary already exists for this region.
 */
export async function createHypothesisFromPattern(
  match: PatternMatch,
  opts: { reasoning_trace_id?: string } = {},
): Promise<{ primary_id: string | null; null_id: string | null }> {
  const sb = getSupabase();
  const region = match.region.name || 'Global';
  const primaryTitle = match.pattern.hypothesisTemplate.replace('{region}', region);

  // Idempotency: if we already have an active primary for this pattern+region, skip.
  const { data: existing } = await sb
    .from('hypotheses')
    .select('id, title, status')
    .eq('region', region)
    .eq('status', 'active')
    .ilike('title', `${primaryTitle.slice(0, Math.min(60, primaryTitle.length))}%`)
    .limit(1);

  if (existing && existing.length > 0) {
    return { primary_id: (existing[0].id as string) ?? null, null_id: null };
  }

  const sources = match.events.map((e) => e.source);
  const diversity = computeSourceDiversity(sources);
  const triggerEventId = match.events.find((e) => e.id)?.id;

  // Beta posterior prior — same shrinkage as forecast-engine
  const n = Math.max(0, match.pattern.historicalSampleSize) + 4;
  const prior =
    (match.pattern.historicalHitRate * Math.max(1, match.pattern.historicalSampleSize) + 2) /
      (Math.max(1, match.pattern.historicalSampleSize) + 4) *
      (Math.max(1, match.pattern.historicalSampleSize) / n) +
    0.5 * (4 / n);
  const initial = Math.max(0.05, Math.min(0.85, prior));

  const { data: pri, error: priErr } = await sb
    .from('hypotheses')
    .insert({
      title: primaryTitle,
      confidence: initial,
      prior_confidence: initial,
      confidence_history: [
        {
          timestamp: new Date().toISOString(),
          confidence: initial,
          reason: `auto-created from pattern '${match.pattern.name}'`,
        },
      ],
      region,
      tags: ['auto', 'pattern', match.pattern.name, ...(match.pattern.alertTier ? [match.pattern.alertTier] : [])],
      trigger_event_id: triggerEventId || null,
      supporting_signals: match.events.map((e) => e.id).filter(Boolean).slice(-15),
      source_diversity: diversity,
      log_odds: logOdds(initial),
      reasoning_trace_id: opts.reasoning_trace_id || null,
      status: 'active',
    })
    .select('id')
    .single();

  if (priErr || !pri?.id) {
    console.error(
      '[hypothesis-board] createHypothesisFromPattern (primary) failed:',
      priErr?.message,
    );
    return { primary_id: null, null_id: null };
  }

  const nullTemplate =
    NULL_HYPOTHESIS_TEMPLATES[match.pattern.name] ||
    'The signals are explained by routine / benign activity, not the pattern hypothesis';
  const nullTitle = nullTemplate.replace('{region}', region);
  const nullPrior = Math.max(0.1, 1 - initial);

  const { data: nul, error: nulErr } = await sb
    .from('hypotheses')
    .insert({
      title: nullTitle,
      confidence: nullPrior,
      prior_confidence: nullPrior,
      confidence_history: [
        {
          timestamp: new Date().toISOString(),
          confidence: nullPrior,
          reason: `auto-created null hypothesis paired with '${match.pattern.name}'`,
        },
      ],
      competing_hypothesis_ids: [pri.id],
      region,
      tags: ['auto', 'null_hypothesis', match.pattern.name],
      log_odds: logOdds(nullPrior),
      status: 'active',
    })
    .select('id')
    .single();

  if (nulErr || !nul?.id) {
    console.error(
      '[hypothesis-board] createHypothesisFromPattern (null) failed:',
      nulErr?.message,
    );
    return { primary_id: pri.id as string, null_id: null };
  }

  // back-link competing pointer on the primary
  await sb
    .from('hypotheses')
    .update({ competing_hypothesis_ids: [nul.id] })
    .eq('id', pri.id);

  return { primary_id: pri.id as string, null_id: nul.id as string };
}

/**
 * Append a critique note (red-team) to a hypothesis's rolling buffer.
 * Used by the reflection engine to keep the strongest counter-arguments
 * visible alongside the confidence.
 */
export async function addHypothesisCritique(
  hypothesisId: string,
  critique: string,
): Promise<void> {
  if (!hypothesisId || !critique?.trim()) return;
  const sb = getSupabase();
  const { data } = await sb
    .from('hypotheses')
    .select('critiques')
    .eq('id', hypothesisId)
    .single();
  const prev = ((data?.critiques as string[]) ?? []).filter((s) => typeof s === 'string');
  const next = [
    ...prev,
    `[${new Date().toISOString().slice(0, 10)}] ${critique.trim().slice(0, 1000)}`,
  ].slice(-10);
  await sb
    .from('hypotheses')
    .update({ critiques: next, last_updated: new Date().toISOString() })
    .eq('id', hypothesisId);
}

import { createClient } from '@supabase/supabase-js';
import type { Belief, ConfidenceEntry, Evidence, IntelEvent } from './types';
import { hoursAgo } from './geo-utils';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

// ── Bayesian confidence update ──────────────────────────────────────────
// Called every time a new event comes in that's relevant to a belief.

function getSignalWeight(event: IntelEvent): number {
  const sourceWeights: Record<string, number> = {
    acled: 0.8, usgs: 0.95, adsb: 0.85, ais: 0.8,
    sam_gov: 0.9, notam: 0.95, firms: 0.6, gdelt: 0.5,
    rss: 0.4, telegram: 0.35, polymarket: 0.55,
    ooni: 0.75, sentinel: 0.7,
  };
  const base = sourceWeights[event.source] ?? 0.5;
  return base * event.confidence * (event.severity / 100);
}

export function updateBeliefConfidence(
  belief: Belief,
  newSignal: IntelEvent,
  supports: boolean,
): number {
  const prior = belief.confidence;
  const strength = getSignalWeight(newSignal);

  // Likelihood ratio: how diagnostic is this signal?
  const lr = supports
    ? 1 + strength * 4    // supporting: LR 1.1–4.6
    : 1 / (1 + strength * 2); // undermining: LR 0.33–0.91

  const posterior = (prior * lr) / (prior * lr + (1 - prior));
  return Math.max(0.02, Math.min(0.98, posterior));
}

// ── Confidence decay — beliefs get stale without new evidence ───────────

const DEFAULT_HALF_LIFE_HOURS: Record<string, number> = {
  military: 72,
  geopolitical: 168,
  economic: 336,
  default: 240,
};

function getBeliefHalfLife(belief: Belief): number {
  for (const tag of belief.tags) {
    if (DEFAULT_HALF_LIFE_HOURS[tag]) return DEFAULT_HALF_LIFE_HOURS[tag];
  }
  return DEFAULT_HALF_LIFE_HOURS.default;
}

function getHistoricalBaseRate(tags: string[]): number {
  // Base rate defaults — what confidence decays toward absent new evidence
  const rates: Record<string, number> = {
    military: 0.25, geopolitical: 0.30, economic: 0.35,
  };
  for (const tag of tags) {
    if (rates[tag]) return rates[tag];
  }
  return 0.30;
}

export function applyConfidenceDecay(belief: Belief): number {
  const hoursSince = hoursAgo(belief.last_updated);
  const halfLife = getBeliefHalfLife(belief);
  const decayFactor = Math.pow(0.5, hoursSince / halfLife);
  const baseRate = getHistoricalBaseRate(belief.tags);
  return baseRate + (belief.confidence - baseRate) * decayFactor;
}

// ── Relevance matching — does an event relate to a belief? ──────────────

export function isEventRelevantToBelief(event: IntelEvent, belief: Belief): boolean {
  const eventText = `${event.title} ${event.summary} ${event.tags.join(' ')}`.toLowerCase();
  const beliefText = `${belief.statement} ${belief.tags.join(' ')} ${belief.entities.join(' ')}`.toLowerCase();

  // Check for shared keywords (entities, regions, tags)
  const beliefTokens = beliefText.split(/\s+/).filter(t => t.length > 3);
  let matchCount = 0;
  for (const token of beliefTokens) {
    if (eventText.includes(token)) matchCount++;
  }

  // Region match
  if (belief.region && event.country_code) {
    const regionLower = belief.region.toLowerCase();
    const cc = event.country_code.toLowerCase();
    if (regionLower.includes(cc) || cc.includes(regionLower)) matchCount += 2;
  }

  // Tag overlap
  const tagOverlap = event.tags.filter(t => belief.tags.includes(t)).length;
  matchCount += tagOverlap;

  return matchCount >= 2;
}

export function doesEventSupportBelief(event: IntelEvent, belief: Belief): boolean {
  // Heuristic: high-severity conflict events support conflict beliefs,
  // positive diplomatic signals undermine them, etc.
  const statement = belief.statement.toLowerCase();
  const isConflictBelief = /escalat|attack|invade|conflict|war|military|strike/.test(statement);
  const isStabilityBelief = /peace|ceasefire|withdraw|negotiate|stable/.test(statement);
  const isConflictEvent = ['conflict', 'airstrike', 'military_flight_isr', 'tanker_surge', 'doomsday_plane'].includes(event.type);

  if (isConflictBelief && isConflictEvent) return true;
  if (isStabilityBelief && isConflictEvent) return false;
  if (isConflictBelief && !isConflictEvent) return false;

  return event.severity > 60;
}

// ── Run against all beliefs after ingestion ─────────────────────────────

/**
 * Diminishing-returns weight for the k-th independent observation from
 * the same source. We treat the first observation as full strength, the
 * second as ~70%, and so on, asymptoting at zero. This prevents a noisy
 * adapter from steamrolling a belief just because it produced 30 events.
 */
function sourceIndependenceWeight(k: number): number {
  if (k <= 0) return 0;
  return 1 / Math.sqrt(k);
}

export async function evaluateAllBeliefsAgainstNewEvents(
  newEvents: IntelEvent[],
): Promise<{ updated: number; conflictsFound: number }> {
  const sb = getSupabase();
  let updated = 0;
  let conflictsFound = 0;

  const { data: beliefs, error } = await sb
    .from('beliefs')
    .select('*')
    .eq('status', 'active');

  if (error || !beliefs) {
    console.error('[belief-engine] Failed to load beliefs:', error?.message);
    return { updated: 0, conflictsFound: 0 };
  }

  for (const rawBelief of beliefs) {
    const belief = rawBelief as Belief;
    const relevantEvents = newEvents.filter(e => isEventRelevantToBelief(e, belief));
    if (relevantEvents.length === 0) continue;

    let currentConfidence = belief.confidence;
    const newHistory: ConfidenceEntry[] = [...(belief.confidence_history || [])];
    const newEvidenceFor: Evidence[] = [...(belief.evidence_for || [])];
    const newEvidenceAgainst: Evidence[] = [...(belief.evidence_against || [])];

    // Sort relevant events by severity so the strongest signals get the
    // first (full-weight) update from each source rather than being
    // dampened by noisy lower-severity duplicates.
    const sortedEvents = [...relevantEvents].sort((a, b) => b.severity - a.severity);
    const sourceCounts = new Map<string, number>();

    for (const event of sortedEvents) {
      const k = (sourceCounts.get(event.source) || 0) + 1;
      sourceCounts.set(event.source, k);
      const indWeight = sourceIndependenceWeight(k);
      // Skip ultra-low-weight repeats — they only add noise.
      if (indWeight < 0.2 && k > 1) continue;

      const supports = doesEventSupportBelief(event, belief);
      // Synthesize a damped event by scaling its severity weight via
      // independence factor before passing to the LR update.
      const dampened: IntelEvent = {
        ...event,
        severity: Math.max(1, Math.round(event.severity * indWeight)),
      };
      currentConfidence = updateBeliefConfidence(
        { ...belief, confidence: currentConfidence },
        dampened,
        supports,
      );

      newHistory.push({
        timestamp: new Date().toISOString(),
        confidence: currentConfidence,
        reason: `${event.type} from ${event.source} (×${k}, w=${indWeight.toFixed(2)}): ${event.title.slice(0, 100)}`,
        event_id: event.id,
      });

      const evidence: Evidence = {
        event_id: event.id || '',
        description: event.title.slice(0, 200),
        weight: getSignalWeight(dampened),
        timestamp: new Date().toISOString(),
      };

      if (supports) {
        newEvidenceFor.push(evidence);
      } else {
        newEvidenceAgainst.push(evidence);
      }
    }

    // Trim history to last 50 entries to manage JSONB size
    const trimmedHistory = newHistory.slice(-50);

    const { error: updateErr } = await sb
      .from('beliefs')
      .update({
        confidence: currentConfidence,
        confidence_history: trimmedHistory,
        evidence_for: newEvidenceFor.slice(-30),
        evidence_against: newEvidenceAgainst.slice(-30),
        last_updated: new Date().toISOString(),
      })
      .eq('id', belief.id);

    if (!updateErr) updated++;

    // Check for user disagreement conflict
    if (belief.user_agrees === false && currentConfidence > 0.75) {
      conflictsFound++;
    }
  }

  // Apply decay to all beliefs not touched by events
  const untouched = (beliefs as Belief[]).filter(
    b => !newEvents.some(e => isEventRelevantToBelief(e, b)),
  );

  for (const belief of untouched) {
    const decayed = applyConfidenceDecay(belief);
    if (Math.abs(decayed - belief.confidence) > 0.01) {
      await sb
        .from('beliefs')
        .update({ confidence: decayed, last_updated: new Date().toISOString() })
        .eq('id', belief.id);
    }
  }

  console.log(`[belief-engine] Updated ${updated} beliefs, ${conflictsFound} conflicts found`);
  return { updated, conflictsFound };
}

// ── CRUD helpers ────────────────────────────────────────────────────────

export async function createBelief(
  statement: string,
  confidence: number,
  opts: {
    tags?: string[];
    region?: string;
    entities?: string[];
    jeff_stake?: 'HIGH' | 'MEDIUM' | 'LOW';
  } = {},
): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('beliefs')
    .insert({
      statement,
      confidence: Math.max(0.02, Math.min(0.98, confidence)),
      confidence_history: [{ timestamp: new Date().toISOString(), confidence, reason: 'initial formation' }],
      tags: opts.tags || [],
      region: opts.region || null,
      entities: opts.entities || [],
      jeff_stake: opts.jeff_stake || 'MEDIUM',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[belief-engine] Create belief failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function getActiveBeliefs(): Promise<Belief[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('beliefs')
    .select('*')
    .eq('status', 'active')
    .order('confidence', { ascending: false });
  return (data || []) as Belief[];
}

export async function getBeliefConflicts(): Promise<Belief[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('beliefs')
    .select('*')
    .eq('status', 'active')
    .eq('user_agrees', false)
    .gte('confidence', 0.6);
  return (data || []) as Belief[];
}

import { createClient } from '@supabase/supabase-js';
import type { Belief, PatternMatch } from './types';
import { buildStructuredPrompt } from './alerts';
import { createHypothesis } from './hypothesis-board';
import { createPrediction } from './prediction-ledger';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

export interface PatternIntelParsed {
  narrative_paragraphs: string;
  hypothesis_primary_title: string;
  hypothesis_competing_title: string;
  prediction_statement: string;
  prediction_confidence: number;
}

function regionSlug(match: PatternMatch): string {
  const n = (match.region.name || 'global').trim() || 'global';
  return n.replace(/\s+/g, '_').slice(0, 64);
}

export function patternDedupeTag(match: PatternMatch): string {
  return `intel_dedupe:${match.pattern.name}|${regionSlug(match)}`;
}

function fillTemplate(template: string, match: PatternMatch): string {
  const region = match.region.name || 'the region';
  return template.replace(/\{region\}/gi, region).slice(0, 280);
}

function fallbackIntel(match: PatternMatch): PatternIntelParsed {
  const primary = fillTemplate(match.pattern.hypothesisTemplate, match);
  return {
    narrative_paragraphs: '',
    hypothesis_primary_title: primary,
    hypothesis_competing_title:
      `Benign or routine explanation: signals in ${match.region.name || 'this area'} do not indicate coordinated escalation.`,
    prediction_statement: `Within ${Math.max(6, Math.round(match.pattern.nextEventMedianHours))}h, follow-on events will corroborate pattern "${match.pattern.name}" in ${match.region.name || 'this region'} (operational significance).`,
    prediction_confidence: Math.max(
      0.08,
      Math.min(0.92, match.pattern.historicalHitRate * 0.85 + (match.composite_severity / 1000)),
    ),
  };
}

/** Single LLM prompt: analyst narrative + structured fields (one API call). */
export function buildPatternIntelPrompt(match: PatternMatch): string {
  const base = buildStructuredPrompt(match);
  return `${base}

ADDITIONAL OUTPUT (same response, valid JSON only — no markdown fences):
Return a single JSON object with exactly these keys:
- "narrative_paragraphs": string — the same 3 paragraphs you would have written above (para breaks as \\n\\n)
- "hypothesis_primary_title": string — max 18 words, concrete primary theory for this pattern in this region
- "hypothesis_competing_title": string — max 18 words, strongest alternative explanation (not vague)
- "prediction_statement": string — one falsifiable claim tied to this pattern, time-bounded (mention hours or days)
- "prediction_confidence": number — your probability 0.05–0.95 the prediction_statement will prove correct

Rules: hypothesis titles must not copy the pattern name verbatim; be specific to the signals listed. JSON only.`;
}

function stripJsonFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    const firstNl = s.indexOf('\n');
    if (firstNl >= 0) s = s.slice(firstNl + 1);
    s = s.replace(/```\s*$/i, '').trim();
  }
  return s;
}

function eventTextBlob(match: PatternMatch): string {
  return [
    match.pattern.name,
    match.pattern.description,
    ...match.events.map(e => `${e.title} ${e.summary}`),
  ]
    .join(' ')
    .toLowerCase();
}

export function parsePatternIntelResponse(raw: string, match: PatternMatch): PatternIntelParsed {
  const fb = fallbackIntel(match);
  if (!raw.trim()) return fb;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
  } catch {
    return { ...fb, narrative_paragraphs: raw.trim().slice(0, 2500) };
  }

  const narrative =
    typeof parsed.narrative_paragraphs === 'string'
      ? parsed.narrative_paragraphs.trim()
      : typeof parsed.narrative === 'string'
        ? parsed.narrative.trim()
        : '';

  const clampTitle = (v: unknown, maxLen: number): string => {
    if (typeof v !== 'string' || !v.trim()) return '';
    return v.trim().replace(/\s+/g, ' ').slice(0, maxLen);
  };

  const primary = clampTitle(parsed.hypothesis_primary_title, 220) || fb.hypothesis_primary_title;
  const competing =
    clampTitle(parsed.hypothesis_competing_title, 220) || fb.hypothesis_competing_title;
  let predStatement =
    typeof parsed.prediction_statement === 'string'
      ? parsed.prediction_statement.trim().slice(0, 400)
      : fb.prediction_statement;

  let predConf = fb.prediction_confidence;
  if (typeof parsed.prediction_confidence === 'number' && Number.isFinite(parsed.prediction_confidence)) {
    predConf = Math.max(0.05, Math.min(0.95, parsed.prediction_confidence));
  }

  if (predStatement.length < 12) predStatement = fb.prediction_statement;

  return {
    narrative_paragraphs: narrative.slice(0, 3500) || fb.narrative_paragraphs,
    hypothesis_primary_title: primary,
    hypothesis_competing_title: competing,
    prediction_statement: predStatement,
    prediction_confidence: predConf,
  };
}

async function findRelatedBeliefId(match: PatternMatch): Promise<string | null> {
  const sb = getSupabase();
  const { data: beliefs } = await sb
    .from('beliefs')
    .select('id,statement,tags,region,entities')
    .eq('status', 'active')
    .limit(80);

  if (!beliefs?.length) return null;

  const blob = `${eventTextBlob(match)} ${(match.region.name || '').toLowerCase()}`;

  let best: { id: string; score: number } | null = null;
  for (const row of beliefs as Belief[]) {
    const parts = [
      row.statement,
      ...(row.tags || []),
      row.region || '',
      ...(row.entities || []),
    ]
      .join(' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3);

    let score = 0;
    for (const w of parts) {
      if (blob.includes(w)) score++;
    }
    if (match.region.name && row.region && row.region === match.region.name) score += 3;
    if (score >= 2 && (!best || score > best.score)) best = { id: row.id, score };
  }
  return best?.id ?? null;
}

async function hypothesisExistsWithDedupe(dedupeTag: string): Promise<string | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from('hypotheses')
    .select('id')
    .eq('status', 'active')
    .contains('tags', [dedupeTag])
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function linkCompetingHypotheses(aId: string, bId: string): Promise<void> {
  const sb = getSupabase();
  await sb
    .from('hypotheses')
    .update({ competing_hypothesis_ids: [bId], last_updated: new Date().toISOString() })
    .eq('id', aId);
  await sb
    .from('hypotheses')
    .update({ competing_hypothesis_ids: [aId], last_updated: new Date().toISOString() })
    .eq('id', bId);
}

function resolveByIso(match: PatternMatch): string {
  const hours = Math.max(6, Math.round(match.pattern.nextEventMedianHours * 1.5));
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function effectivePatternHitRate(match: PatternMatch): Promise<number> {
  const sb = getSupabase();
  const { data } = await sb
    .from('pattern_calibration')
    .select('resolved_total, resolved_correct')
    .eq('pattern_name', match.pattern.name)
    .maybeSingle();

  const total = data?.resolved_total ?? 0;
  const correct = data?.resolved_correct ?? 0;
  if (total >= 5) {
    return Math.max(0.08, Math.min(0.92, correct / total));
  }
  return match.pattern.historicalHitRate;
}

async function empiricalConfidence(match: PatternMatch, parsedConf: number): Promise<number> {
  const empirical = await effectivePatternHitRate(match);
  const w = Math.min(0.4, (match.pattern.historicalSampleSize || 0) / 150);
  return Math.max(0.06, Math.min(0.94, parsedConf * (1 - w) + empirical * w));
}

/**
 * Persists correlation row, competing hypotheses, and Jeff prediction — idempotent per pattern+region per cycle.
 */
export async function persistPatternIntel(
  match: PatternMatch,
  parsed: PatternIntelParsed,
  narrativeForRow: string,
): Promise<void> {
  const sb = getSupabase();
  const dedupe = patternDedupeTag(match);
  const eventIds = match.events.map(e => e.id).filter(Boolean) as string[];
  const triggerId = eventIds[0] || null;

  const existingHypo = await hypothesisExistsWithDedupe(dedupe);
  let primaryId = existingHypo;

  const tagsBase = [
    dedupe,
    `pattern:${match.pattern.name}`,
    'source:pattern_match',
    ...(match.pattern.name.includes('sanction') ? ['sanctions'] : []),
    ...(match.pattern.name.includes('doomsday') ? ['military'] : []),
  ];

  const region = match.region.name && match.region.name.length === 2 ? match.region.name : match.region.name || null;

  if (!primaryId) {
    const hit = await effectivePatternHitRate(match);
    const initial = Math.max(0.12, Math.min(0.72, hit * 0.9));
    primaryId = await createHypothesis(parsed.hypothesis_primary_title, initial, {
      region: region || undefined,
      tags: tagsBase,
      trigger_event_id: triggerId || undefined,
    });

    if (primaryId && parsed.hypothesis_competing_title) {
      const altInitial = Math.max(0.08, Math.min(0.45, 1 - initial - 0.05));
      const altId = await createHypothesis(parsed.hypothesis_competing_title, altInitial, {
        region: region || undefined,
        tags: [...tagsBase, 'role:competing'],
        trigger_event_id: triggerId || undefined,
      });
      if (altId) await linkCompetingHypotheses(primaryId, altId);
    }
  }

  const relatedBeliefId = await findRelatedBeliefId(match);

  const { data: existingPred } = await sb
    .from('predictions')
    .select('id')
    .is('resolved_at', null)
    .contains('tags', [dedupe])
    .limit(1)
    .maybeSingle();

  if (!existingPred?.id) {
    const mergedConf = await empiricalConfidence(match, parsed.prediction_confidence);
    await createPrediction('jeff', parsed.prediction_statement, mergedConf, {
      resolve_by: resolveByIso(match),
      tags: tagsBase,
      region: region || undefined,
      related_belief_id: relatedBeliefId || undefined,
    });
  }

  const { error } = await sb.from('correlations').insert({
    pattern_name: match.pattern.name,
    event_ids: eventIds.length ? eventIds : null,
    sources: [...new Set(match.events.map(e => e.source))],
    region: match.region.name,
    country_code: match.region.name?.length === 2 ? match.region.name : null,
    time_window_hours: match.pattern.timeWindowHours,
    severity_composite: match.composite_severity,
    narrative: (narrativeForRow || parsed.narrative_paragraphs).slice(0, 8000),
    hypothesis_id: primaryId,
  });

  if (error) {
    console.error('[pattern-intel] correlation insert failed:', error.message);
  }
}

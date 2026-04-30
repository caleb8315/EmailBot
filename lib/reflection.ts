/**
 * Reflection Engine.
 *
 * Periodic (default: nightly) deep self-review pass. Where the ingest
 * loop does fast incremental updates, the reflection engine takes a
 * step back and asks the harder questions:
 *
 *   • Are any high-stake hypotheses being propped up by single-source
 *     evidence? (low source diversity → red-team critique)
 *   • Have any beliefs gone stale or developed a confidence-vs-evidence
 *     mismatch we should flip?
 *   • Are any predictions past their resolve_by date with public
 *     evidence we can use to auto-resolve?
 *
 * Output is recorded as a `reflection` engine_run plus reasoning_traces
 * for each item it touches. Designed to be idempotent and budget-safe:
 * it only spends LLM calls when `reasoning` deliberation is justified.
 */
import { trySharedSupabase } from './shared/supabase';
import { startEngineRun, finishEngineRun } from './shared/engine-run';
import type { Hypothesis, Belief, Prediction } from './types';
import { deliberate, attachTraceToHypothesis } from './reasoning';
import { addHypothesisCritique } from './hypothesis-board';
import { resolvePrediction } from './prediction-ledger';

const HIGH_STAKE_BRIER = 0.30;
const FLIP_THRESHOLD = 0.85;             // belief vs user_agrees mismatch
const STALE_HOURS = 24 * 14;             // 14 days

interface ReflectionResult {
  hypotheses_critiqued: number;
  beliefs_challenged: number;
  predictions_auto_resolved: number;
  ai_calls_used: number;
}

interface DraftableHypothesis extends Hypothesis {
  source_diversity?: number | null;
  critiques?: string[] | null;
}

async function loadHypotheses(): Promise<DraftableHypothesis[]> {
  const sb = trySharedSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('hypotheses')
    .select('*')
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .limit(20);
  return (data || []) as DraftableHypothesis[];
}

async function loadBeliefs(): Promise<Belief[]> {
  const sb = trySharedSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('beliefs')
    .select('*')
    .eq('status', 'active')
    .gte('confidence', 0.6)
    .limit(40);
  return (data || []) as Belief[];
}

async function loadOverduePredictions(): Promise<Prediction[]> {
  const sb = trySharedSupabase();
  if (!sb) return [];
  const now = new Date().toISOString();
  const { data } = await sb
    .from('predictions')
    .select('*')
    .is('resolved_at', null)
    .lte('resolve_by', now)
    .limit(20);
  return (data || []) as Prediction[];
}

function pickSuspectHypotheses(hypotheses: DraftableHypothesis[]): DraftableHypothesis[] {
  return hypotheses.filter((h) => {
    if (h.confidence >= 0.7 && (h.source_diversity ?? 0) < 0.4) return true;
    const hist = h.confidence_history || [];
    if (hist.length >= 6) {
      const recent = hist.slice(-3).map((e) => e.confidence);
      const earlier = hist.slice(-6, -3).map((e) => e.confidence);
      const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const earlierMean = earlier.reduce((a, b) => a + b, 0) / earlier.length;
      if (recentMean - earlierMean > 0.25) return true;
    }
    return false;
  });
}

async function critiqueHypothesis(h: DraftableHypothesis): Promise<{ ai: number }> {
  const supportCount = (h.supporting_signals || []).length;
  const undermineCount = (h.undermining_signals || []).length;
  const context = [
    `Title: ${h.title}`,
    `Confidence: ${(h.confidence * 100).toFixed(0)}%`,
    `Prior: ${((h.prior_confidence ?? 0.5) * 100).toFixed(0)}%`,
    `Source diversity: ${((h.source_diversity ?? 0) * 100).toFixed(0)}%`,
    `Supporting signals: ${supportCount}`,
    `Undermining signals: ${undermineCount}`,
    `Region: ${h.region || 'global'}`,
  ].join('\n');

  const question = `Red-team this active hypothesis Jeff is currently tracking. Identify
the single strongest reason it might be wrong, and the most likely benign
or mundane explanation that would not require accepting it. Conclude with
a single line:

VERDICT: <KEEP | REVISE | REJECT>
RECOMMENDED CONFIDENCE: NN%`;

  const result = await deliberate({
    task: 'reflection_hypothesis',
    question,
    context,
    topic: h.title.slice(0, 80),
    region: h.region,
    tags: ['reflection', 'red_team'],
    inputs: { hypothesis_id: h.id },
    samples: 1,
    critique: false,
    judge: false,
    useCase: 'narrative',
    attach: { hypothesis_ids: [h.id] },
  });

  if (result.final) {
    await addHypothesisCritique(h.id, result.final);
    await attachTraceToHypothesis(result.trace_id, h.id);
  }
  return { ai: 1 };
}

async function flagBelief(b: Belief): Promise<{ ai: number }> {
  const sb = trySharedSupabase();
  if (!sb) return { ai: 0 };
  const stale = b.last_updated
    ? (Date.now() - new Date(b.last_updated).getTime()) / 3_600_000 > STALE_HOURS
    : false;
  const userMismatch = b.user_agrees === false && b.confidence > FLIP_THRESHOLD;
  if (!stale && !userMismatch) return { ai: 0 };

  const reason = userMismatch
    ? 'belief held with high confidence despite user disagreement'
    : 'belief untouched for >14 days';
  await sb
    .from('beliefs')
    .update({
      last_challenged: new Date().toISOString(),
      confidence_history: [
        ...(b.confidence_history || []),
        {
          timestamp: new Date().toISOString(),
          confidence: b.confidence,
          reason: `reflection flag: ${reason}`,
        },
      ].slice(-50),
    })
    .eq('id', b.id);
  return { ai: 0 };
}

async function tryAutoResolve(p: Prediction): Promise<{ resolved: boolean; ai: number }> {
  // Only attempt if we have at least the decomposition + falsifier — these
  // give us something to compare current evidence against. Otherwise leave
  // it for manual review.
  const decomp = (p as Prediction & {
    decomposition?: { falsifier?: string; mechanism?: string };
  }).decomposition;
  if (!decomp || !decomp.falsifier) return { resolved: false, ai: 0 };

  const sb = trySharedSupabase();
  if (!sb) return { resolved: false, ai: 0 };

  // Pull the most recent intel events that share the prediction's region
  // or tags as a cheap retrieval step. The deliberation then judges
  // whether the falsifier is met / not met.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: events } = await sb
    .from('intel_events')
    .select('source, type, severity, title, summary, country_code, timestamp')
    .gte('timestamp', since)
    .order('severity', { ascending: false })
    .limit(40);

  const eventLines = (events || [])
    .filter((e) => !p.region || e.country_code === p.region)
    .slice(0, 20)
    .map((e) => `- [${e.source}/${e.type}] ${e.title} (sev=${e.severity}, ${e.country_code})`)
    .join('\n');

  const context = [
    `Prediction: ${p.statement}`,
    `Made at: ${p.made_at}`,
    `Resolve by: ${p.resolve_by}`,
    `Stated confidence: ${((p.confidence_at_prediction || 0) * 100).toFixed(0)}%`,
    `Mechanism: ${decomp.mechanism || 'n/a'}`,
    `Falsifier: ${decomp.falsifier}`,
    '',
    'Recent relevant signals:',
    eventLines || '(none)',
  ].join('\n');

  const question = `Based on the evidence, has this prediction occurred, failed, or is still open?

Return JSON:
{"verdict":"correct"|"incorrect"|"partial"|"unresolvable","confidence":0..1,"rationale":"..."}`;

  const result = await deliberate({
    task: 'reflection_auto_resolve',
    question,
    context,
    region: p.region,
    tags: ['reflection', 'auto_resolve', ...(p.tags || [])],
    inputs: { prediction_id: p.id },
    samples: 1,
    critique: false,
    judge: false,
    useCase: 'extraction',
    attach: { prediction_ids: [p.id] },
  });

  let parsed: { verdict?: string; confidence?: number; rationale?: string } | null = null;
  try {
    const cleaned = (result.final || '').replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = null;
  }

  // Only auto-resolve if the model is highly confident; otherwise the
  // prediction stays open for human review (preserving correctness over
  // throughput).
  const verdict = parsed?.verdict;
  const conf = parsed?.confidence ?? 0;
  if (
    !verdict ||
    !['correct', 'incorrect', 'partial', 'unresolvable'].includes(verdict) ||
    conf < 0.75
  ) {
    return { resolved: false, ai: 1 };
  }

  try {
    await resolvePrediction(
      p.id,
      verdict as 'correct' | 'incorrect' | 'partial' | 'unresolvable',
      parsed?.rationale || 'auto-resolved by reflection engine',
      { auto_resolution_sources: events?.slice(0, 5) ?? [] },
    );
    return { resolved: true, ai: 1 };
  } catch (err) {
    console.error(
      '[reflection] auto-resolve failed:',
      err instanceof Error ? err.message : String(err),
    );
    return { resolved: false, ai: 1 };
  }
}

export async function runReflectionEngine(): Promise<ReflectionResult> {
  const runId = await startEngineRun('dreamtime', { stage: 'reflection' });
  const out: ReflectionResult = {
    hypotheses_critiqued: 0,
    beliefs_challenged: 0,
    predictions_auto_resolved: 0,
    ai_calls_used: 0,
  };

  try {
    const [hypotheses, beliefs, overdue] = await Promise.all([
      loadHypotheses(),
      loadBeliefs(),
      loadOverduePredictions(),
    ]);

    const suspect = pickSuspectHypotheses(hypotheses).slice(0, 5);
    for (const h of suspect) {
      const r = await critiqueHypothesis(h);
      out.hypotheses_critiqued++;
      out.ai_calls_used += r.ai;
    }

    for (const b of beliefs.slice(0, 20)) {
      const r = await flagBelief(b);
      out.beliefs_challenged++;
      out.ai_calls_used += r.ai;
    }

    for (const p of overdue.slice(0, 8)) {
      const r = await tryAutoResolve(p);
      if (r.resolved) out.predictions_auto_resolved++;
      out.ai_calls_used += r.ai;
    }

    await finishEngineRun(runId, {
      status: 'success',
      records_in: hypotheses.length + beliefs.length + overdue.length,
      records_out:
        out.hypotheses_critiqued + out.beliefs_challenged + out.predictions_auto_resolved,
      ai_calls_used: out.ai_calls_used,
      meta: { ...out },
    });
  } catch (err) {
    await finishEngineRun(runId, {
      status: 'error',
      errors: [err instanceof Error ? err.message : String(err)],
      meta: { ...out },
    });
    console.error('[reflection] failed:', err);
  }

  return out;
}

if (require.main === module) {
  runReflectionEngine()
    .then((r) => {
      console.log('[reflection] done:', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[reflection] fatal:', err);
      process.exit(1);
    });
}

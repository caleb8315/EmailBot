/**
 * Jeff's deliberation engine.
 *
 * The rest of the system used to call an LLM once and trust the answer.
 * That gives shallow, overconfident outputs. This module wraps every
 * "thinking" step in a structured loop:
 *
 *      draft → red-team critique → revise → judge
 *
 * with optional self-consistency (n parallel drafts), and persists the
 * full chain into Supabase `reasoning_traces` so we can audit *why*
 * Jeff said something.
 *
 * It is intentionally model-agnostic — everything routes through the
 * existing `callLLM` helper, which respects per-purpose budgets and
 * provider routing (Groq / Gemini / OpenAI-compatible).
 *
 * Calibration:
 *   - We pull the latest calibration row from `user_profile` and apply
 *     a temperature-style adjustment to the model's stated probability,
 *     pulling overconfident forecasts toward the historical observed
 *     frequency for the matching reliability bin. This makes raw LLM
 *     numbers safer to use as actual forecasts.
 */
import { trySharedSupabase } from './shared/supabase';
import { callLLM } from './llm';

export interface DeliberationStep {
  role: 'think' | 'critique' | 'revise' | 'judge' | 'sample';
  content: string;
  model?: string;
  temperature?: number;
  timestamp: string;
  score?: number;
}

export interface DeliberationInput {
  task: string;                                  // 'pattern_alert' | 'forecast' | 'reflection' | ...
  question: string;                              // the actual prompt / question
  context?: string;                              // structured context block (multi-line)
  topic?: string;
  region?: string;
  tags?: string[];
  inputs?: Record<string, unknown>;              // e.g. event_ids, beliefs considered
  /** When > 1, run that many parallel "think" samples (self-consistency). */
  samples?: number;
  /** When true, run an explicit red-team critique pass before revising. */
  critique?: boolean;
  /** When true, run a final judge pass that scores the answer 0–10. */
  judge?: boolean;
  /** Use case for budget routing. */
  useCase?: 'narrative' | 'dreamtime' | 'brief' | 'extraction' | 'conversation';
  /** Persist the trace in Supabase. Default: true. */
  persist?: boolean;
  /** Optional — link this trace to a forecast/hypothesis later. */
  attach?: {
    prediction_ids?: string[];
    hypothesis_ids?: string[];
    belief_ids?: string[];
    fused_signal_ids?: string[];
    correlation_ids?: string[];
  };
}

export interface DeliberationOutput {
  trace_id: string | null;
  steps: DeliberationStep[];
  samples: string[];
  sample_agreement: number;                       // 0..1
  final: string;                                  // canonical natural-language answer
  confidence: number;                             // 0..1, calibrated
  uncertainty: number;                            // 0..1, derived from samples + critique
  critique?: string;
  judgement?: { score: number; rationale: string };
  elapsed_ms: number;
}

// ── Internal helpers ─────────────────────────────────────────────────

const DEFAULT_USE_CASE: DeliberationInput['useCase'] = 'narrative';

function nowIso(): string {
  return new Date().toISOString();
}

function buildContextBlock(input: DeliberationInput): string {
  const parts: string[] = [];
  if (input.region) parts.push(`Region: ${input.region}`);
  if (input.topic) parts.push(`Topic: ${input.topic}`);
  if (input.tags && input.tags.length > 0)
    parts.push(`Tags: ${input.tags.join(', ')}`);
  if (input.context) parts.push(input.context.trim());
  return parts.join('\n');
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function computeAgreement(samples: string[]): number {
  if (samples.length <= 1) return 1;
  const tokenSets = samples.map(tokenSet);
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      sum += jaccard(tokenSets[i], tokenSets[j]);
      pairs++;
    }
  }
  return pairs === 0 ? 1 : sum / pairs;
}

const PROB_REGEX =
  /\b(?:probability|p\s*[:=]?|chance|confidence|odds)\s*(?:is\s*)?(?:approximately\s*)?(?:~|about\s*)?(\d{1,3})(?:\.(\d+))?\s*%?/i;
const STANDALONE_PCT = /\b(\d{1,3})(?:\.(\d+))?\s*%/;
const DECIMAL_PROB = /\bp\s*[:=]\s*(0?\.\d+|1\.0+|0+)/i;

export function extractStatedProbability(text: string): number | null {
  const m1 = text.match(PROB_REGEX);
  if (m1) {
    const major = parseInt(m1[1], 10);
    const minor = m1[2] ? parseFloat(`0.${m1[2]}`) : 0;
    const num = major + minor;
    if (Number.isFinite(num)) {
      return num <= 1 ? num : num / 100;
    }
  }
  const m2 = text.match(DECIMAL_PROB);
  if (m2) {
    const v = parseFloat(m2[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  }
  const m3 = text.match(STANDALONE_PCT);
  if (m3) {
    const major = parseInt(m3[1], 10);
    const minor = m3[2] ? parseFloat(`0.${m3[2]}`) : 0;
    const num = major + minor;
    if (Number.isFinite(num) && num >= 0 && num <= 100) return num / 100;
  }
  return null;
}

// ── Calibration adjustment ───────────────────────────────────────────

interface CalibrationBin {
  bin: number;
  predicted: number;
  observed: number;
  n: number;
}

async function loadCalibrationCurve(opts: {
  topic?: string;
  region?: string;
}): Promise<CalibrationBin[]> {
  const sb = trySharedSupabase();
  if (!sb) return [];
  try {
    let q = sb
      .from('prediction_calibration_bins')
      .select('bin, mean_predicted, mean_observed, n_predictions, topic, region')
      .eq('predictor', 'jeff');
    if (opts.region) q = q.eq('region', opts.region);
    if (opts.topic) q = q.eq('topic', opts.topic);
    const { data, error } = await q;
    if (error || !data || data.length === 0) {
      // fall back to overall curve
      const { data: overall } = await sb
        .from('prediction_calibration_bins')
        .select('bin, mean_predicted, mean_observed, n_predictions')
        .eq('predictor', 'jeff')
        .is('topic', null)
        .is('region', null);
      return (overall || []).map((b) => ({
        bin: b.bin as number,
        predicted: b.mean_predicted as number,
        observed: b.mean_observed as number,
        n: b.n_predictions as number,
      }));
    }
    return data.map((b) => ({
      bin: b.bin as number,
      predicted: b.mean_predicted as number,
      observed: b.mean_observed as number,
      n: b.n_predictions as number,
    }));
  } catch {
    return [];
  }
}

/**
 * Map a raw model-stated probability through the historical reliability
 * curve so that systematically over/under-confident outputs are pulled
 * toward what we actually observe. Bins with little data fall back
 * toward the raw value (no over-correction from noise).
 */
export function calibrateProbability(
  raw: number,
  curve: CalibrationBin[],
  minSamplesForFullPull = 20,
): number {
  if (!Number.isFinite(raw)) return 0.5;
  const clamped = Math.max(0.02, Math.min(0.98, raw));
  if (!curve || curve.length === 0) return clamped;
  const idx = Math.min(9, Math.max(0, Math.floor(clamped * 10)));
  const bin = curve.find((b) => b.bin === idx);
  if (!bin || bin.n <= 0) return clamped;
  // pull strength scales with sample size — a bin with 5 samples barely moves
  const pull = Math.min(1, bin.n / minSamplesForFullPull);
  const adjusted = clamped + (bin.observed - bin.predicted) * pull;
  return Math.max(0.02, Math.min(0.98, adjusted));
}

// ── Single-shot draft with optional retry ────────────────────────────

type ResolvedUseCase = NonNullable<DeliberationInput['useCase']>;

async function draft(
  prompt: string,
  useCase: ResolvedUseCase,
): Promise<string> {
  try {
    const text = await callLLM(prompt, useCase);
    return (text || '').trim();
  } catch (err) {
    console.error(
      '[reasoning] draft failed:',
      err instanceof Error ? err.message : String(err),
    );
    return '';
  }
}

// ── Critic / red-team ────────────────────────────────────────────────

function buildCritiquePrompt(question: string, context: string, draftText: string): string {
  return `You are a ruthless red-team analyst reviewing a colleague's draft.

QUESTION:
${question}

CONTEXT:
${context || '(no extra context)'}

DRAFT ANSWER:
${draftText}

Your job:
1. Identify the single strongest argument that the draft is WRONG.
2. Identify any unstated assumption that, if false, breaks the conclusion.
3. Identify the most likely benign / mundane explanation that the draft ignores.
4. Identify any quantitative claim (probability, count, hours) that is not justified by the evidence shown.

Be terse. No flattery. 1–4 paragraphs. End with a single line:
"VERDICT: <KEEP | REVISE | REJECT>"`;
}

// ── Reviser ─────────────────────────────────────────────────────────

function buildRevisePrompt(
  question: string,
  context: string,
  draftText: string,
  critique: string,
): string {
  return `You wrote this draft. A red-team analyst challenged it. Produce a final answer
that addresses the strongest critiques honestly. If the critique is right, change
your conclusion. If it is wrong, refute it explicitly.

QUESTION:
${question}

CONTEXT:
${context || '(no extra context)'}

ORIGINAL DRAFT:
${draftText}

RED-TEAM CRITIQUE:
${critique}

Output the final answer only — no preamble. If a probability is appropriate,
state it as "Probability: NN%" on its own line. Keep it under 280 words.`;
}

// ── Judge ───────────────────────────────────────────────────────────

function buildJudgePrompt(question: string, finalText: string): string {
  return `Grade the following answer to this question.

QUESTION:
${question}

ANSWER:
${finalText}

Score 0–10 on each dimension and then give an overall score.
Dimensions: evidence, mechanism (does it explain *why*), falsifiability,
calibration (are probabilities defensible), and clarity.

Return JSON: {"overall": N, "rationale": "one paragraph"}`;
}

// ── Main entrypoint ─────────────────────────────────────────────────

export async function deliberate(
  input: DeliberationInput,
): Promise<DeliberationOutput> {
  const startedAt = Date.now();
  const useCase: ResolvedUseCase = (input.useCase ?? DEFAULT_USE_CASE)!;
  const persist = input.persist !== false;
  const sampleCount = Math.max(1, Math.min(5, input.samples ?? 1));
  const steps: DeliberationStep[] = [];
  const context = buildContextBlock(input);

  // 1) Draft samples (self-consistency if samples > 1)
  const samples: string[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const text = await draft(
      `${input.question}\n\nCONTEXT:\n${context || '(no extra context)'}`,
      useCase,
    );
    samples.push(text);
    steps.push({
      role: 'sample',
      content: text,
      timestamp: nowIso(),
    });
  }

  // pick the sample whose tokens overlap the most with the others — the
  // "consensus" draft. This is a cheap local stand-in for majority vote
  // on a free-text answer.
  const sampleAgreement = computeAgreement(samples);
  let bestIdx = 0;
  if (samples.length > 1) {
    const tokenSets = samples.map(tokenSet);
    let bestScore = -1;
    for (let i = 0; i < samples.length; i++) {
      let score = 0;
      for (let j = 0; j < samples.length; j++) {
        if (i === j) continue;
        score += jaccard(tokenSets[i], tokenSets[j]);
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }
  const draftText = samples[bestIdx] || '';
  steps.push({
    role: 'think',
    content: draftText,
    timestamp: nowIso(),
  });

  // 2) Optional critique
  let critique: string | undefined;
  if (input.critique && draftText) {
    critique = (await draft(
      buildCritiquePrompt(input.question, context, draftText),
      useCase,
    )).trim();
    if (critique) {
      steps.push({
        role: 'critique',
        content: critique,
        timestamp: nowIso(),
      });
    }
  }

  // 3) Revise (only if we got a non-empty critique)
  let finalText = draftText;
  if (critique) {
    const revised = (
      await draft(buildRevisePrompt(input.question, context, draftText, critique), useCase)
    ).trim();
    if (revised) {
      finalText = revised;
      steps.push({
        role: 'revise',
        content: revised,
        timestamp: nowIso(),
      });
    }
  }

  // 4) Optional judge pass
  let judgement: { score: number; rationale: string } | undefined;
  if (input.judge && finalText) {
    const verdictRaw = await draft(buildJudgePrompt(input.question, finalText), useCase);
    if (verdictRaw) {
      try {
        const cleaned = verdictRaw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned) as {
          overall?: number;
          rationale?: string;
        };
        if (typeof parsed.overall === 'number') {
          judgement = {
            score: Math.max(0, Math.min(10, parsed.overall)),
            rationale: parsed.rationale || '',
          };
          steps.push({
            role: 'judge',
            content: verdictRaw,
            timestamp: nowIso(),
            score: judgement.score,
          });
        }
      } catch {
        // ignore — judge is optional
      }
    }
  }

  // 5) Confidence + uncertainty
  const stated = extractStatedProbability(finalText);
  const calibCurve = await loadCalibrationCurve({
    topic: input.topic,
    region: input.region,
  });
  const calibrated = stated == null ? 0.5 : calibrateProbability(stated, calibCurve);

  // uncertainty grows when samples disagree, when critique forced a
  // revision, and when the judge gave a low score.
  let uncertainty = 1 - sampleAgreement;
  if (critique) uncertainty = Math.min(1, uncertainty + 0.1);
  if (judgement && judgement.score < 6) {
    uncertainty = Math.min(1, uncertainty + (6 - judgement.score) * 0.05);
  }

  // confidence used for downstream weighting: pulls toward calibrated
  // forecast but reduces with uncertainty.
  const confidence = Math.max(
    0.02,
    Math.min(0.98, calibrated * (1 - 0.5 * uncertainty) + 0.5 * 0.5 * uncertainty),
  );

  // 6) Persist the trace
  const trace_id = persist
    ? await persistTrace({
        task: input.task,
        topic: input.topic,
        region: input.region,
        tags: input.tags,
        steps,
        samples,
        sample_agreement: sampleAgreement,
        confidence,
        uncertainty,
        novelty: 0, // will be populated by callers that compare to beliefs
        inputs: input.inputs ?? {},
        output: {
          final: finalText,
          stated_probability: stated,
          calibrated_probability: calibrated,
          critique,
          judgement,
        },
        prediction_ids: input.attach?.prediction_ids,
        hypothesis_ids: input.attach?.hypothesis_ids,
        belief_ids: input.attach?.belief_ids,
        fused_signal_ids: input.attach?.fused_signal_ids,
        correlation_ids: input.attach?.correlation_ids,
        elapsed_ms: Date.now() - startedAt,
      })
    : null;

  return {
    trace_id,
    steps,
    samples,
    sample_agreement: sampleAgreement,
    final: finalText,
    confidence,
    uncertainty,
    critique,
    judgement,
    elapsed_ms: Date.now() - startedAt,
  };
}

// ── Persistence ──────────────────────────────────────────────────────

interface PersistArgs {
  task: string;
  topic?: string;
  region?: string;
  tags?: string[];
  steps: DeliberationStep[];
  samples: string[];
  sample_agreement: number;
  confidence: number;
  uncertainty: number;
  novelty: number;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  prediction_ids?: string[];
  hypothesis_ids?: string[];
  belief_ids?: string[];
  fused_signal_ids?: string[];
  correlation_ids?: string[];
  elapsed_ms: number;
}

async function persistTrace(args: PersistArgs): Promise<string | null> {
  const sb = trySharedSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('reasoning_traces')
      .insert({
        task: args.task,
        topic: args.topic ?? null,
        region: args.region ?? null,
        tags: args.tags ?? [],
        steps: args.steps,
        inputs: args.inputs,
        output: args.output,
        samples: args.samples,
        sample_agreement: args.sample_agreement,
        confidence: args.confidence,
        uncertainty: args.uncertainty,
        novelty: args.novelty,
        prediction_ids: args.prediction_ids ?? [],
        hypothesis_ids: args.hypothesis_ids ?? [],
        belief_ids: args.belief_ids ?? [],
        fused_signal_ids: args.fused_signal_ids ?? [],
        correlation_ids: args.correlation_ids ?? [],
        elapsed_ms: args.elapsed_ms,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[reasoning] persistTrace failed:', error.message);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (err) {
    console.error(
      '[reasoning] persistTrace exception:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export async function attachTraceToPrediction(
  traceId: string | null,
  predictionId: string,
): Promise<void> {
  if (!traceId) return;
  const sb = trySharedSupabase();
  if (!sb) return;
  try {
    await sb
      .from('predictions')
      .update({ reasoning_trace_id: traceId })
      .eq('id', predictionId);
    const { data: trace } = await sb
      .from('reasoning_traces')
      .select('prediction_ids')
      .eq('id', traceId)
      .single();
    const ids = ((trace?.prediction_ids as string[]) ?? []).filter(Boolean);
    if (!ids.includes(predictionId)) ids.push(predictionId);
    await sb
      .from('reasoning_traces')
      .update({ prediction_ids: ids })
      .eq('id', traceId);
  } catch (err) {
    console.error(
      '[reasoning] attachTraceToPrediction failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function attachTraceToHypothesis(
  traceId: string | null,
  hypothesisId: string,
): Promise<void> {
  if (!traceId) return;
  const sb = trySharedSupabase();
  if (!sb) return;
  try {
    await sb
      .from('hypotheses')
      .update({ reasoning_trace_id: traceId })
      .eq('id', hypothesisId);
    const { data: trace } = await sb
      .from('reasoning_traces')
      .select('hypothesis_ids')
      .eq('id', traceId)
      .single();
    const ids = ((trace?.hypothesis_ids as string[]) ?? []).filter(Boolean);
    if (!ids.includes(hypothesisId)) ids.push(hypothesisId);
    await sb
      .from('reasoning_traces')
      .update({ hypothesis_ids: ids })
      .eq('id', traceId);
  } catch (err) {
    console.error(
      '[reasoning] attachTraceToHypothesis failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Forecast Engine.
 *
 * Translates structural pattern matches and narrative arcs into actual
 * stored, scored predictions. Until now, `pattern.historicalHitRate` and
 * `arc.next_act_predicted` were *informational*: nothing recorded a
 * forecast that we could later score. This module:
 *
 *   1. Derives a Bayesian prior from the pattern's hit rate + sample
 *      size (Beta(α=hits, β=misses) → posterior mean).
 *   2. Adjusts that prior by the composite severity, source diversity,
 *      and per-region calibration history (we trust ourselves less in
 *      regions where we are historically miscalibrated).
 *   3. Optionally runs a deeper red-team deliberation that pulls the
 *      model toward calibrated probability and writes a structured
 *      decomposition (mechanism + signals + falsifier).
 *   4. Stores the prediction via `createPrediction`, links the
 *      reasoning trace, and returns the prediction id.
 *
 * Result: every alert and every advancing arc creates an audit-grade
 * forecast with `resolve_by`, mechanism, and falsifier — making the
 * system measurable, not just narratively impressive.
 */
import { trySharedSupabase } from './shared/supabase';
import type { PatternMatch, NarrativeArc } from './types';
import {
  createPrediction,
  type ForecastDecomposition,
} from './prediction-ledger';
import { deliberate, attachTraceToPrediction } from './reasoning';

const CONFIDENCE_FLOOR = 0.05;
const CONFIDENCE_CEIL = 0.95;
const PRIOR_SAMPLE_FALLBACK = 5;

interface RegionCalib {
  brier_avg: number | null;
  observed_minus_predicted: number;     // signed bias from reliability curve
}

async function loadRegionCalib(region?: string): Promise<RegionCalib> {
  const sb = trySharedSupabase();
  if (!sb || !region) return { brier_avg: null, observed_minus_predicted: 0 };
  try {
    const { data } = await sb
      .from('prediction_calibration_bins')
      .select('mean_predicted, mean_observed, n_predictions, brier_avg')
      .eq('predictor', 'jeff')
      .eq('region', region);
    if (!data || data.length === 0) return { brier_avg: null, observed_minus_predicted: 0 };
    let totalN = 0;
    let weightedBias = 0;
    let weightedBrier = 0;
    for (const b of data) {
      const n = (b.n_predictions as number) || 0;
      if (n === 0) continue;
      totalN += n;
      weightedBias += n * (((b.mean_observed as number) ?? 0) - ((b.mean_predicted as number) ?? 0));
      weightedBrier += n * ((b.brier_avg as number) ?? 0);
    }
    if (totalN === 0) return { brier_avg: null, observed_minus_predicted: 0 };
    return {
      brier_avg: weightedBrier / totalN,
      observed_minus_predicted: weightedBias / totalN,
    };
  } catch {
    return { brier_avg: null, observed_minus_predicted: 0 };
  }
}

/**
 * Beta-prior posterior mean for a pattern: shrinks claimed hit rate
 * toward 0.5 when sample size is small (regularizes overconfidence).
 */
export function patternPosteriorMean(
  historicalHitRate: number,
  sampleSize: number,
  pseudoCount = 4,
): number {
  const n = Math.max(0, sampleSize) + pseudoCount;
  // pseudo-count is added as Beta(2,2) — pulls toward 0.5
  const alpha = historicalHitRate * Math.max(1, sampleSize) + 2;
  const beta = (1 - historicalHitRate) * Math.max(1, sampleSize) + 2;
  return alpha / (alpha + beta) * (Math.max(1, sampleSize) / n) +
    0.5 * (pseudoCount / n);
}

interface PatternForecastResult {
  prediction_id: string | null;
  trace_id: string | null;
  probability: number;
  resolve_by: string;
  decomposition: ForecastDecomposition;
}

/**
 * Auto-generate a stored forecast from a pattern match.
 * Returns the new prediction id (or null if disabled / unavailable).
 */
export async function forecastFromPattern(
  match: PatternMatch,
  opts: {
    deepReasoning?: boolean;          // default true for FLASH/PRIORITY
    samples?: number;                 // self-consistency samples
  } = {},
): Promise<PatternForecastResult> {
  const horizonHours = Math.max(1, match.pattern.nextEventMedianHours || 48);
  const resolveAt = new Date(Date.now() + horizonHours * 3 * 60 * 60 * 1000); // 3x the median for grace

  // 1) Beta-prior from the pattern's historical track record
  const priorMean = patternPosteriorMean(
    match.pattern.historicalHitRate,
    match.pattern.historicalSampleSize || PRIOR_SAMPLE_FALLBACK,
  );

  // 2) Severity & source-diversity bumps. A pattern firing at composite
  //    severity 95 with 5 distinct sources should outrank the same pattern
  //    firing at severity 60 with 1 source.
  const severityFactor = (match.composite_severity || match.pattern.severity) / 100;
  const distinctSources = new Set(match.events.map((e) => e.source)).size;
  const diversityFactor = Math.min(1, distinctSources / 4); // 4+ distinct = full credit

  // 3) Per-region calibration adjustment (pull toward observed bias)
  const regionCalib = await loadRegionCalib(match.region.name?.length === 2 ? match.region.name : undefined);

  // Combine: weighted geometric pull toward severity-adjusted prior, then
  // bias correction from history.
  const rawProb =
    priorMean * (0.7 + 0.3 * severityFactor) * (0.85 + 0.15 * diversityFactor);
  const calibrated = Math.max(
    CONFIDENCE_FLOOR,
    Math.min(CONFIDENCE_CEIL, rawProb + 0.5 * regionCalib.observed_minus_predicted),
  );

  const baseDecomposition: ForecastDecomposition = {
    base_rate: match.pattern.historicalHitRate,
    mechanism: match.pattern.description,
    key_signals: match.events
      .slice(0, 6)
      .map((e) => `${e.type} (${e.source}): ${e.title.slice(0, 80)}`),
    falsifier: `No follow-up event matching the pattern within ${horizonHours * 3}h, or active counter-evidence (e.g. de-escalation).`,
    ci_low: Math.max(CONFIDENCE_FLOOR, calibrated - 0.15),
    ci_high: Math.min(CONFIDENCE_CEIL, calibrated + 0.15),
  };

  const useDeep =
    opts.deepReasoning ?? (match.pattern.alertTier === 'FLASH' || match.pattern.alertTier === 'PRIORITY');

  let finalProb = calibrated;
  let traceId: string | null = null;
  let mechanism = baseDecomposition.mechanism;
  let falsifier = baseDecomposition.falsifier;

  if (useDeep) {
    const context = [
      `Pattern: ${match.pattern.name}`,
      `Description: ${match.pattern.description}`,
      `Composite severity: ${match.composite_severity?.toFixed(0) ?? 'n/a'}/100`,
      `Distinct sources: ${distinctSources}`,
      `Historical hit-rate: ${(match.pattern.historicalHitRate * 100).toFixed(0)}% (n=${match.pattern.historicalSampleSize})`,
      `Beta-posterior prior: ${(priorMean * 100).toFixed(0)}%`,
      `Region calibration bias (obs - pred): ${(regionCalib.observed_minus_predicted * 100).toFixed(0)}%`,
      'Triggering signals:',
      ...match.events.slice(0, 8).map((e) => `  • [${e.source}/${e.type}] ${e.title.slice(0, 100)} (sev=${e.severity})`),
    ].join('\n');

    const question = `Forecast: a real-world event consistent with the hypothesis "${match.pattern.hypothesisTemplate.replace('{region}', match.region.name || 'region')}" will occur within the next ${horizonHours * 3} hours.

Use the pattern's calibrated prior of ${(calibrated * 100).toFixed(0)}% as your starting point but justify any movement.

End your answer with three labelled lines:
Probability: NN%
Mechanism: <one paragraph>
Falsifier: <one sentence describing what observation would prove this wrong>`;

    const result = await deliberate({
      task: 'forecast',
      question,
      context,
      topic: match.pattern.name,
      region: match.region.name,
      tags: ['forecast', match.pattern.name, ...(match.pattern.alertTier ? [match.pattern.alertTier] : [])],
      inputs: {
        pattern_name: match.pattern.name,
        prior: priorMean,
        calibrated_prior: calibrated,
        event_ids: match.events.map((e) => e.id).filter(Boolean),
      },
      samples: opts.samples ?? (match.pattern.alertTier === 'FLASH' ? 3 : 1),
      critique: true,
      judge: false,
      useCase: 'narrative',
    });

    finalProb = result.confidence;
    traceId = result.trace_id;

    const mechMatch = result.final.match(/Mechanism\s*:\s*([\s\S]*?)(?:\n[A-Z][a-z]+\s*:|\n*$)/i);
    if (mechMatch) mechanism = mechMatch[1].trim();
    const falsMatch = result.final.match(/Falsifier\s*:\s*([\s\S]*?)$/i);
    if (falsMatch) falsifier = falsMatch[1].trim();
  }

  const decomposition: ForecastDecomposition = {
    ...baseDecomposition,
    mechanism,
    falsifier,
  };

  const statement =
    match.pattern.hypothesisTemplate.replace('{region}', match.region.name || 'region') +
    ` (within ${Math.round((horizonHours * 3) / 24)}d)`;

  const predictionId = await createPrediction('jeff', statement, finalProb, {
    resolve_by: resolveAt.toISOString(),
    tags: ['auto', 'pattern', match.pattern.name, ...(match.region.name ? [match.region.name] : [])],
    region: match.region.name,
    decomposition,
    ensemble: {
      source: 'pattern',
      pattern_name: match.pattern.name,
      prior_mean: priorMean,
      severity_factor: severityFactor,
      diversity_factor: diversityFactor,
      region_bias: regionCalib.observed_minus_predicted,
    },
    reasoning_trace_id: traceId ?? undefined,
  });

  if (predictionId) {
    await attachTraceToPrediction(traceId, predictionId);
  }

  return {
    prediction_id: predictionId,
    trace_id: traceId,
    probability: finalProb,
    resolve_by: resolveAt.toISOString(),
    decomposition,
  };
}

/**
 * Auto-forecast that the next-act of a narrative arc occurs within the
 * pattern's historical median × 2 window.
 */
export async function forecastFromArc(arc: NarrativeArc): Promise<string | null> {
  if (!arc.next_act_predicted || !arc.next_act_median_hours) return null;
  const horizon = Math.max(12, arc.next_act_median_hours * 2);
  const prior = arc.historical_accuracy ?? 0.5;
  const probability = Math.max(CONFIDENCE_FLOOR, Math.min(CONFIDENCE_CEIL, prior * 0.7 + 0.15));
  const resolveAt = new Date(Date.now() + horizon * 60 * 60 * 1000).toISOString();

  return await createPrediction(
    'jeff',
    `Narrative arc "${arc.title}" advances to act "${arc.next_act_predicted}" within ${Math.round(horizon)}h`,
    probability,
    {
      resolve_by: resolveAt,
      tags: ['auto', 'arc', arc.pattern_matched ?? 'arc', ...(arc.region ? [arc.region] : [])],
      region: arc.region,
      decomposition: {
        base_rate: prior,
        mechanism: `Historical pattern "${arc.pattern_matched}" advances on this median timeline.`,
        falsifier: 'No matching event-type from any monitored source within the window.',
      },
      ensemble: { source: 'arc', arc_id: arc.id, pattern: arc.pattern_matched },
    },
  );
}

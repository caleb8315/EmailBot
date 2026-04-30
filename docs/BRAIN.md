# The Brain — How Jeff thinks (deliberation, calibration, prediction)

This file is the **single source of truth for Jeff's reasoning depth**. If
you ever wonder _"how strong are our predictions and brains, and how do
they get stronger over time?"_ — read this.

It is intentionally written next to the code, not in a wiki, so that
every change to the reasoning pipeline must update this file too.

---

## 1. Layered architecture

Jeff is **not** a single LLM call. He's a stack of cooperating engines,
each with its own job, and an outer **deliberation engine** that wraps
the LLM steps in a structured "think → red-team → revise" loop.

```
                              ┌────────────────────────────┐
   Adapters (RSS, ACLED,      │ lib/ingest.ts              │
   ADS-B, OONI, Polymarket,…) │                            │
   ──► IntelEvent ──► verify ─┤  0. narrative_cluster from │
                              │     io-detector            │
                              │  1. rules-engine patterns  │
                              │  2. forecast-engine +      │
                              │     hypothesis (primary +  │
                              │     null) + deliberation   │
                              │  3. belief-engine          │
                              │  4. hypothesis-board       │
                              │  5. narrative-arc          │
                              │  6. anomaly-detector       │
                              └────────────────────────────┘
                                          │
                                          ▼
                              ┌────────────────────────────┐
                              │ lib/reasoning.ts           │
                              │                            │
                              │  draft  ──► critique ──►   │
                              │  revise ──► judge ──►      │
                              │  calibrate ──► persist     │
                              │  (self-consistency: N)     │
                              └────────────────────────────┘
                                          │
                                          ▼
                              ┌────────────────────────────┐
                              │ lib/reflection.ts (nightly)│
                              │                            │
                              │  - red-team suspect        │
                              │    hypotheses              │
                              │  - flag stale beliefs      │
                              │  - auto-resolve overdue    │
                              │    predictions when the    │
                              │    falsifier is met        │
                              └────────────────────────────┘
                                          │
                                          ▼
                              ┌────────────────────────────┐
                              │ lib/synthesis-composer.ts  │
                              │  fused signals → digest /  │
                              │  alerts / dashboard        │
                              └────────────────────────────┘
```

---

## 2. What "stronger predictions" means here

The previous version of this system was good at producing _commentary_
but bad at producing _measurable forecasts_. The new pipeline makes
five concrete improvements:

| Problem before | What we changed | Where |
|---|---|---|
| Single LLM call per task; no critique | `deliberate()` runs draft → red-team → revise + optional self-consistency samples + judge | `lib/reasoning.ts` |
| Pattern matches never produced a stored prediction | `forecastFromPattern()` derives a Bayesian Beta-prior from `historicalHitRate` & `historicalSampleSize`, adjusts by composite severity, source diversity, and per-region calibration bias, then writes a `prediction` row with `decomposition` (mechanism + falsifier) | `lib/forecast-engine.ts` |
| Hypothesis board never auto-formed; one-sided | Each pattern match now spawns a primary hypothesis _and_ a null hypothesis, linked via `competing_hypothesis_ids`. Both update on every new event | `lib/hypothesis-board.ts` (`createHypothesisFromPattern`) |
| Belief engine treated 30 events from the same source as 30 independent updates | We damp repeats with `1/√k` (sqrt-N independence), clipping below w=0.2 | `lib/belief-engine.ts` (`sourceIndependenceWeight`) |
| Calibration tracked as a hit-rate proxy (`brier < 0.25 ⇒ "correct"`), no reliability curve | New `prediction_calibration_bins` table is updated streamingly (Welford means) per (predictor, bin, topic, region). `user_profile.brier_avg`, `log_loss_avg`, `calibration_curve` reflect actual reliability | `supabase/migrations/20260430_001_deeper_reasoning.sql`, `lib/prediction-ledger.ts` |
| `io-detector` was orphaned | `narrativeClustersToEvents()` emits `narrative_cluster` IntelEvents inside `ingest`, closing the loop with `rules-engine`'s `io_campaign_detected` pattern | `lib/io-detector.ts`, `lib/ingest.ts` |
| Predictions piled up overdue with no resolver | `runReflectionEngine()` retrieves recent intel events for each overdue prediction and auto-resolves only when the LLM is ≥ 75% confident the falsifier is met | `lib/reflection.ts` |

---

## 3. The deliberation loop

`deliberate()` accepts:

```ts
{ task, question, context, samples?, critique?, judge?, useCase? }
```

and returns a fully-traced `DeliberationOutput` with the canonical
final answer, calibrated probability, samples, agreement score, and a
trace id pointing to a `reasoning_traces` row.

The **calibration step** is where the brain stops being credulous: it
extracts the probability the model stated, looks up the matching bin
from our historical reliability curve (per topic / region / overall in
that order), and pulls the raw probability toward the observed
frequency. Bins with low sample size pull weakly; bins with many
samples pull strongly. This means **even an over-confident base model
will produce well-calibrated forecasts after a few weeks of resolutions.**

```
    raw 70%  →  curve says: when we said 70% before, only 50% were right
                            (n=20 samples)
    pull = min(1, n/20) = 1
    adjusted = 0.7 + (0.5 − 0.7) × 1 = 0.5
```

The combined deliverable is:

```
 confidence = calibrated × (1 − 0.5 × uncertainty) + 0.5 × 0.5 × uncertainty
 uncertainty = (1 − sample_agreement) + (critique ? 0.1 : 0) + judge_penalty
```

so that disagreement between samples, an effective red-team critique,
and a low judge score all _widen_ the posterior toward 50%.

---

## 4. Forecast pipeline (per pattern match)

`forecastFromPattern(match)`:

1. **Beta posterior** from history:
   ```
   α = hitRate × n + 2,   β = (1 − hitRate) × n + 2
   prior = α/(α+β)
   ```
   (a Beta(2,2) pseudo-prior shrinks low-n claims toward 50%.)
2. **Severity factor** = `composite_severity / 100`.
3. **Diversity factor** = `min(1, distinct_sources / 4)`.
4. **Region bias correction** from `prediction_calibration_bins` —
   `(observed − predicted)` averaged across that region's bins.
5. Optional **deep deliberation** for FLASH/PRIORITY tiers (with N=3
   self-consistency samples + critique). Mechanism / falsifier / final
   probability are parsed back out and stored in `predictions.decomposition`.

The result is a real, scorable forecast: a `predictions` row with
`resolve_by`, `mechanism`, `falsifier`, `ensemble`, `calibration_bin`,
and a `reasoning_trace_id`.

---

## 5. Reliability tracking

When a prediction resolves, we update **three views** atomically:

1. The prediction row gets `brier_score`, `log_loss`, `calibration_bin`.
2. `prediction_calibration_bins` for `(predictor, bin, topic, region)`
   gets a streaming Welford update of `mean_predicted` /
   `mean_observed` / `brier_avg` / `log_loss_avg`. We update overall,
   per-region, and per top-3 tags so the dashboard can slice it.
3. `user_profile` gets running `brier_avg`, `log_loss_avg`, and a
   summary `calibration_curve` that powers the reliability diagram.

`getUserCalibrationReport()` returns all three so anything that wants
to render a Jeff-vs-user comparison or a reliability diagram has one
tidy contract.

---

## 6. Reflection (nightly self-review)

`runReflectionEngine()` is the deep-thinking job. It walks three lists:

* **Suspect hypotheses**: confidence ≥ 70% with `source_diversity < 0.4`,
  or sharp upward drift over the last 6 confidence entries. Each gets a
  red-team deliberation; the critique is stored in `hypotheses.critiques`
  (rolling buffer of the 10 most recent).
* **High-confidence beliefs** that are stale (>14 days) or in conflict
  with `user_agrees = false`. Flagged in `last_challenged` for review.
* **Overdue predictions** whose `falsifier` we can compare against
  recent regional intel events. Auto-resolved only when the LLM is
  ≥ 75% confident — otherwise stays open for human review.

Run it on a schedule (e.g., the existing GitHub Action that fires the
morning digest, or a separate cron) with `npm run reflection`.

---

## 7. Knobs (env vars)

The new behavior is on by default but can be toggled individually:

| Var | Default | Effect when set |
|---|---|---|
| `DEEP_REASONING_PATTERNS` | `true` | When `false`, falls back to the old single-shot LLM narrative |
| `AUTO_HYPOTHESES` | `true` | When `false`, ingest stops auto-creating primary/null hypothesis pairs |
| `AUTO_FORECASTS` | `true` | When `false`, ingest stops writing forecasts to `predictions` |

Because all deliberations route through `lib/llm.ts` → `usage_limiter`,
budget caps still apply. Self-consistency samples consume one budget
slot each.

---

## 8. Tests

Pure-math regressions (no Supabase / no LLM) so they run in CI:

```
npm run test:reasoning           # extractStatedProbability + calibrateProbability
npm run test:prediction-ledger   # Brier, log-loss, calibration bin
npm run test:forecast-engine     # patternPosteriorMean shrinkage
npm run test:hypothesis-board    # source diversity (Shannon)
npm run test:brain               # all of the above + verification
```

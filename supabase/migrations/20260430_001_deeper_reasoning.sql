-- ============================================================
-- JEFF INTELLIGENCE AGENT — Deeper Reasoning Layer
-- ============================================================
-- Adds:
--   * reasoning_traces — every multi-step deliberation Jeff performs
--     (think → critique → revise → score), with self-consistency samples,
--     confidence, evidence, and links back to the artifacts they produced
--     (predictions, hypotheses, alerts, fused signals).
--   * Extra columns on `predictions` for log-loss, calibration bin,
--     ensemble metadata, decomposition, and auto-resolution sources.
--   * A `prediction_calibration_bins` table that lets us draw a real
--     reliability diagram (predicted vs. observed frequency, per bucket,
--     per topic, per region).
--   * Extra columns on `hypotheses` for evidence diversity tracking,
--     last critique, and the auto-derived posterior log-odds.
-- ============================================================

-- ── Reasoning trace: every chain-of-thought we keep ────────────────────
CREATE TABLE IF NOT EXISTS reasoning_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task TEXT NOT NULL,                 -- e.g. 'pattern_alert', 'forecast', 'reflection'
  topic TEXT,                         -- optional, free text (region/entity/pattern)
  region TEXT,
  tags TEXT[] DEFAULT '{}',

  -- Deliberation steps (drafts, critiques, revisions). Each entry is:
  --   { role: 'think'|'critique'|'revise'|'judge'|'sample',
  --     content: string,
  --     model?: string,
  --     temperature?: number,
  --     timestamp: iso,
  --     score?: number }
  steps JSONB NOT NULL DEFAULT '[]',

  -- Inputs we conditioned on (event ids, belief ids, hypothesis ids,
  -- article ids, base rates, prior calibrations).
  inputs JSONB NOT NULL DEFAULT '{}',

  -- Final output (structured): the verdict / forecast / hypothesis seed.
  output JSONB,

  -- Self-consistency samples — n parallel completions whose agreement
  -- becomes a meta-confidence number.
  samples JSONB DEFAULT '[]',
  sample_agreement FLOAT,             -- 0..1, fraction agreeing with majority

  confidence FLOAT,                   -- final calibrated probability or 1-Brier proxy
  uncertainty FLOAT,                  -- spread/entropy across samples (0..1)
  novelty FLOAT,                      -- 0..1, how new vs prior beliefs

  -- Cross-links so we can audit which prediction came from which trace
  prediction_ids UUID[] DEFAULT '{}',
  hypothesis_ids UUID[] DEFAULT '{}',
  belief_ids UUID[] DEFAULT '{}',
  fused_signal_ids UUID[] DEFAULT '{}',
  correlation_ids UUID[] DEFAULT '{}',

  -- Aggregate token / model accounting (best-effort)
  models_used TEXT[] DEFAULT '{}',
  total_tokens INTEGER DEFAULT 0,
  elapsed_ms INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reasoning_traces_task ON reasoning_traces(task);
CREATE INDEX IF NOT EXISTS idx_reasoning_traces_region ON reasoning_traces(region);
CREATE INDEX IF NOT EXISTS idx_reasoning_traces_created_at
  ON reasoning_traces(created_at DESC);

ALTER TABLE reasoning_traces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_reasoning_traces" ON reasoning_traces;
CREATE POLICY "service_all_reasoning_traces" ON reasoning_traces
  FOR ALL USING (true) WITH CHECK (true);

-- ── Prediction extensions ──────────────────────────────────────────────
-- log_loss = -[y log p + (1-y) log(1-p)] for resolved predictions; lets us
-- compute proper-scoring-rule averages alongside Brier.
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS log_loss FLOAT;

-- bucketed reliability bin (0..9 for predicted_probability bands of 0.1)
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS calibration_bin INTEGER;

-- ensemble metadata (how many models / samples / which ones agreed)
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS ensemble JSONB DEFAULT '{}';

-- structured decomposition: { base_rate, mechanism, key_signals, falsifier }
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS decomposition JSONB DEFAULT '{}';

-- back-link to the reasoning trace that produced the forecast
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS reasoning_trace_id UUID REFERENCES reasoning_traces(id)
    ON DELETE SET NULL;

-- automatically extracted resolution sources (URLs, event ids)
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS auto_resolution_sources JSONB DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_predictions_calibration_bin
  ON predictions(calibration_bin);

-- ── Reliability diagram store ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_calibration_bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predictor TEXT NOT NULL,            -- 'jeff' | 'user' | 'jeff_auto'
  bin INTEGER NOT NULL,               -- 0..9
  topic TEXT,                         -- optional tag scope; '' / null = overall
  region TEXT,                        -- optional region scope; '' / null = overall
  n_predictions INTEGER NOT NULL DEFAULT 0,
  mean_predicted FLOAT NOT NULL DEFAULT 0,
  mean_observed FLOAT NOT NULL DEFAULT 0,
  brier_avg FLOAT,
  log_loss_avg FLOAT,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(predictor, bin, topic, region)
);

ALTER TABLE prediction_calibration_bins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_calibration_bins" ON prediction_calibration_bins;
CREATE POLICY "service_all_calibration_bins" ON prediction_calibration_bins
  FOR ALL USING (true) WITH CHECK (true);

-- ── Hypothesis extensions ──────────────────────────────────────────────
-- Independent source diversity (Shannon-like 0..1 score from supporting
-- signal sources).
ALTER TABLE hypotheses
  ADD COLUMN IF NOT EXISTS source_diversity FLOAT;

-- log-odds posterior to avoid floating-point underflow at extreme prob.
ALTER TABLE hypotheses
  ADD COLUMN IF NOT EXISTS log_odds FLOAT;

-- last red-team critique (rotating buffer kept as JSONB array of strings)
ALTER TABLE hypotheses
  ADD COLUMN IF NOT EXISTS critiques JSONB DEFAULT '[]';

-- the reasoning trace that birthed this hypothesis (if any)
ALTER TABLE hypotheses
  ADD COLUMN IF NOT EXISTS reasoning_trace_id UUID REFERENCES reasoning_traces(id)
    ON DELETE SET NULL;

-- ── User profile extensions for richer calibration ─────────────────────
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS brier_avg FLOAT;
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS log_loss_avg FLOAT;
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS calibration_curve JSONB DEFAULT '[]'; -- array of {bin, n, predicted, observed}
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS resolved_count INTEGER DEFAULT 0;

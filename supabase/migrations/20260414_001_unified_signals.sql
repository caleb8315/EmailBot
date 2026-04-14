-- ============================================================
-- Unified Signal + Engine Run Ledger
-- Bridges article_history and intel_events into one queryable layer
-- ============================================================

-- Cross-engine fused signals (produced by the synthesis composer)
CREATE TABLE IF NOT EXISTS fused_signals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Core signal fields
  headline       TEXT NOT NULL,
  summary        TEXT,
  category       TEXT,
  severity       INTEGER NOT NULL DEFAULT 50,
  confidence     FLOAT NOT NULL DEFAULT 0.5,
  alert_tier     TEXT NOT NULL DEFAULT 'DAILY'
                   CHECK (alert_tier IN ('FLASH', 'PRIORITY', 'DAILY', 'WEEKLY')),

  -- Corroboration metadata
  source_engines TEXT[] NOT NULL DEFAULT '{}',
  article_ids    UUID[],
  event_ids      UUID[],
  entity_ids     UUID[],

  -- Geo (nullable — not every signal is place-bound)
  location       GEOGRAPHY(POINT),
  country_code   TEXT,

  -- Analyst context
  corroboration  JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  dismissed      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_fused_signals_created ON fused_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fused_signals_tier ON fused_signals (alert_tier);
CREATE INDEX IF NOT EXISTS idx_fused_signals_severity ON fused_signals (severity DESC);
CREATE INDEX IF NOT EXISTS idx_fused_signals_location ON fused_signals USING GIST(location);

-- Engine-run ledger — one row per pipeline/ingest/digest/dreamtime execution
CREATE TABLE IF NOT EXISTS engine_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine         TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'success', 'partial', 'error')),
  records_in     INTEGER DEFAULT 0,
  records_out    INTEGER DEFAULT 0,
  ai_calls_used  INTEGER DEFAULT 0,
  errors         JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_engine_runs_engine ON engine_runs (engine);
CREATE INDEX IF NOT EXISTS idx_engine_runs_started ON engine_runs (started_at DESC);

-- Add engine_origin to article_history so articles can be joined with engine runs
DO $$ BEGIN
  ALTER TABLE article_history ADD COLUMN engine_origin TEXT DEFAULT 'news_pipeline';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- RLS
ALTER TABLE fused_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE engine_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_fused_signals" ON fused_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_engine_runs" ON engine_runs FOR ALL USING (true) WITH CHECK (true);

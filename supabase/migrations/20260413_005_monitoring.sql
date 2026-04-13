-- ============================================================
-- JEFF INTELLIGENCE AGENT — Watches, Country Risk, Markets
-- ============================================================

CREATE TABLE IF NOT EXISTS watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  watch_type TEXT NOT NULL,
  definition JSONB NOT NULL,
  tripwire_conditions JSONB,
  conditions_met INTEGER DEFAULT 0,
  conditions_total INTEGER,
  status TEXT DEFAULT 'active',
  alert_tier TEXT DEFAULT 'PRIORITY',
  last_triggered TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watches_status ON watches(status);
CREATE INDEX IF NOT EXISTS idx_watches_type ON watches(watch_type);

CREATE TABLE IF NOT EXISTS country_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL,
  score FLOAT NOT NULL,
  score_delta_24h FLOAT,
  score_delta_7d FLOAT,
  components JSONB,
  instability_trend TEXT,
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(country_code, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_country_risk_code ON country_risk_scores(country_code);
CREATE INDEX IF NOT EXISTS idx_country_risk_date ON country_risk_scores(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_country_risk_score ON country_risk_scores(score DESC);

CREATE TABLE IF NOT EXISTS prediction_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  question TEXT NOT NULL,
  current_probability FLOAT,
  probability_24h_ago FLOAT,
  probability_7d_ago FLOAT,
  delta_24h FLOAT,
  volume_usd FLOAT,
  resolve_date TIMESTAMPTZ,
  tags TEXT[],
  region TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_pred_markets_platform ON prediction_markets(platform);
CREATE INDEX IF NOT EXISTS idx_pred_markets_delta ON prediction_markets(delta_24h DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE country_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_markets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_watches" ON watches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_country_risk" ON country_risk_scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_pred_markets" ON prediction_markets FOR ALL USING (true) WITH CHECK (true);

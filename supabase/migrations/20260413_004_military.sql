-- ============================================================
-- JEFF INTELLIGENCE AGENT — Military & Procurement Intel
-- ============================================================

CREATE TABLE IF NOT EXISTS procurement_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  contract_id TEXT,
  title TEXT NOT NULL,
  agency TEXT,
  value_usd FLOAT,
  award_date DATE,
  category TEXT,
  significance_score FLOAT,
  significance_reason TEXT,
  country_codes TEXT[],
  related_entity_ids UUID[],
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_source ON procurement_signals(source);
CREATE INDEX IF NOT EXISTS idx_procurement_significance ON procurement_signals(significance_score DESC);
CREATE INDEX IF NOT EXISTS idx_procurement_category ON procurement_signals(category);

CREATE TABLE IF NOT EXISTS satellite_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location GEOGRAPHY(POINT),
  location_name TEXT,
  country_code TEXT,
  observation_date DATE NOT NULL,
  image_url TEXT,
  change_detected BOOLEAN DEFAULT FALSE,
  change_description TEXT,
  change_type TEXT,
  significance_score FLOAT,
  baseline_image_date DATE,
  related_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_satellite_location ON satellite_observations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_satellite_date ON satellite_observations(observation_date DESC);
CREATE INDEX IF NOT EXISTS idx_satellite_change ON satellite_observations(change_detected) WHERE change_detected = TRUE;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE procurement_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE satellite_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_procurement" ON procurement_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_satellite" ON satellite_observations FOR ALL USING (true) WITH CHECK (true);

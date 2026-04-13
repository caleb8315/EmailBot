-- ============================================================
-- JEFF INTELLIGENCE AGENT — Hypothesis Board & Narrative Arcs
-- ============================================================

CREATE TABLE IF NOT EXISTS hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  prior_confidence FLOAT NOT NULL,
  confidence_history JSONB DEFAULT '[]',
  competing_hypothesis_ids UUID[],
  supporting_signals JSONB DEFAULT '[]',
  undermining_signals JSONB DEFAULT '[]',
  status TEXT DEFAULT 'active',
  trigger_event_id UUID REFERENCES intel_events(id) ON DELETE SET NULL,
  region TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hypotheses_status ON hypotheses(status);
CREATE INDEX IF NOT EXISTS idx_hypotheses_confidence ON hypotheses(confidence DESC);

CREATE TABLE IF NOT EXISTS narrative_arcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  current_act INTEGER DEFAULT 1,
  total_acts INTEGER,
  act_descriptions JSONB,
  pattern_matched TEXT,
  historical_matches JSONB,
  historical_accuracy FLOAT,
  next_act_predicted TEXT,
  next_act_median_hours FLOAT,
  actors JSONB,
  event_ids UUID[],
  region TEXT,
  lat FLOAT,
  lng FLOAT,
  status TEXT DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_narrative_arcs_status ON narrative_arcs(status);

CREATE TABLE IF NOT EXISTS correlations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_name TEXT NOT NULL,
  event_ids UUID[],
  sources TEXT[],
  region TEXT,
  country_code TEXT,
  location GEOGRAPHY(POINT),
  radius_km FLOAT,
  time_window_hours FLOAT,
  severity_composite FLOAT,
  narrative TEXT,
  hypothesis_id UUID REFERENCES hypotheses(id) ON DELETE SET NULL,
  arc_id UUID REFERENCES narrative_arcs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correlations_pattern ON correlations(pattern_name);
CREATE INDEX IF NOT EXISTS idx_correlations_location ON correlations USING GIST(location);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE narrative_arcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE correlations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_hypotheses" ON hypotheses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_narrative_arcs" ON narrative_arcs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_correlations" ON correlations FOR ALL USING (true) WITH CHECK (true);

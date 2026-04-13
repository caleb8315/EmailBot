-- ============================================================
-- JEFF INTELLIGENCE AGENT — Belief Engine & Prediction Ledger
-- ============================================================

-- Jeff's beliefs about the world
CREATE TABLE IF NOT EXISTS beliefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  confidence_history JSONB DEFAULT '[]',
  formed_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  last_challenged TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  evidence_for JSONB DEFAULT '[]',
  evidence_against JSONB DEFAULT '[]',
  tags TEXT[],
  region TEXT,
  entities TEXT[],
  jeff_stake TEXT,
  user_agrees BOOLEAN,
  user_confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beliefs_status ON beliefs(status);
CREATE INDEX IF NOT EXISTS idx_beliefs_confidence ON beliefs(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_beliefs_region ON beliefs(region);

-- User's stated beliefs (separate from Jeff's)
CREATE TABLE IF NOT EXISTS user_beliefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  source TEXT,
  conversation_context TEXT,
  formed_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active',
  jeff_belief_id UUID REFERENCES beliefs(id) ON DELETE SET NULL,
  agrees_with_jeff BOOLEAN,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_beliefs_status ON user_beliefs(status);

-- Prediction ledger (yours and Jeff's)
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predictor TEXT NOT NULL,
  statement TEXT NOT NULL,
  confidence_at_prediction FLOAT NOT NULL,
  made_at TIMESTAMPTZ DEFAULT NOW(),
  resolve_by TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  outcome TEXT,
  outcome_notes TEXT,
  brier_score FLOAT,
  confidence_history JSONB DEFAULT '[]',
  tags TEXT[],
  region TEXT,
  related_belief_id UUID REFERENCES beliefs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predictions_predictor ON predictions(predictor);
CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON predictions(outcome);
CREATE INDEX IF NOT EXISTS idx_predictions_resolve_by ON predictions(resolve_by);

-- User profile and calibration
CREATE TABLE IF NOT EXISTS user_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regions_of_interest TEXT[],
  known_contacts JSONB,
  expertise_areas TEXT[],
  known_blindspots TEXT[],
  calibration_score FLOAT,
  calibration_by_region JSONB,
  calibration_by_topic JSONB,
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE beliefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_beliefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_beliefs" ON beliefs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_user_beliefs" ON user_beliefs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_predictions" ON predictions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_user_profile" ON user_profile FOR ALL USING (true) WITH CHECK (true);

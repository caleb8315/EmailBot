-- Rolling empirical stats for rules-engine patterns (updated when Jeff predictions resolve).

CREATE TABLE IF NOT EXISTS pattern_calibration (
  pattern_name TEXT PRIMARY KEY,
  resolved_total INTEGER NOT NULL DEFAULT 0,
  resolved_correct REAL NOT NULL DEFAULT 0,
  last_outcome_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_calibration_updated ON pattern_calibration(updated_at DESC);

ALTER TABLE pattern_calibration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_pattern_calibration" ON pattern_calibration FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- JEFF INTELLIGENCE AGENT — Dreamtime, Conversations, AAR
-- ============================================================

CREATE TABLE IF NOT EXISTS dreamtime_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_date DATE NOT NULL,
  scenario_type TEXT NOT NULL,
  title TEXT NOT NULL,
  narrative TEXT NOT NULL,
  probability FLOAT,
  market_implied_probability FLOAT,
  jeff_probability FLOAT,
  signal_chain JSONB,
  impact_level TEXT,
  user_read BOOLEAN DEFAULT FALSE,
  user_reaction TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dreamtime_date ON dreamtime_scenarios(generated_date DESC);
CREATE INDEX IF NOT EXISTS idx_dreamtime_type ON dreamtime_scenarios(scenario_type);
CREATE INDEX IF NOT EXISTS idx_dreamtime_unread ON dreamtime_scenarios(user_read) WHERE user_read = FALSE;

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  messages JSONB NOT NULL,
  beliefs_extracted UUID[],
  predictions_extracted UUID[],
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);
CREATE INDEX IF NOT EXISTS idx_conversations_last ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS after_action_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_title TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL,
  signals_that_predicted_it JSONB,
  signals_jeff_missed JSONB,
  jeff_was_right_about JSONB,
  jeff_was_wrong_about JSONB,
  user_was_right_about JSONB,
  user_was_wrong_about JSONB,
  lessons JSONB,
  model_weight_updates JSONB,
  narrative TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aar_resolved ON after_action_reports(resolved_at DESC);

-- ============================================================
-- TTL cleanup function for intel_events (7-day rolling window)
-- Run via pg_cron or scheduled Supabase function
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_expired_intel_events()
RETURNS void AS $$
BEGIN
  DELETE FROM intel_events
  WHERE (expires_at IS NOT NULL AND expires_at < NOW())
     OR (expires_at IS NULL AND created_at < NOW() - INTERVAL '7 days');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE dreamtime_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE after_action_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_dreamtime" ON dreamtime_scenarios FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_conversations" ON conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_aar" ON after_action_reports FOR ALL USING (true) WITH CHECK (true);

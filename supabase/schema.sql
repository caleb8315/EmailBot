-- ============================================================
-- Selective Intelligence System — Supabase Schema
-- ============================================================

-- Track daily AI usage (reset every 24h)
CREATE TABLE IF NOT EXISTS usage_tracking (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date        DATE NOT NULL UNIQUE,
  api_calls_used INTEGER NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_date ON usage_tracking (date);

-- User preferences and learning memory
CREATE TABLE IF NOT EXISTS user_preferences (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE,
  interests   TEXT[] NOT NULL DEFAULT '{}',
  dislikes    TEXT[] NOT NULL DEFAULT '{}',
  alert_sensitivity INTEGER NOT NULL DEFAULT 5 CHECK (alert_sensitivity >= 1 AND alert_sensitivity <= 10),
  trusted_sources TEXT[] NOT NULL DEFAULT '{}',
  blocked_sources TEXT[] NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences (user_id);

-- All articles ever seen (deduplication + history)
CREATE TABLE IF NOT EXISTS article_history (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url             TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  source          TEXT NOT NULL,
  summary         TEXT,
  importance_score NUMERIC,
  credibility_score NUMERIC,
  relevance_score NUMERIC,
  ai_processed    BOOLEAN NOT NULL DEFAULT false,
  user_feedback   TEXT,
  alerted         BOOLEAN NOT NULL DEFAULT false,
  emailed         BOOLEAN NOT NULL DEFAULT false,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_article_history_url ON article_history (url);
CREATE INDEX IF NOT EXISTS idx_article_history_fetched_at ON article_history (fetched_at);

-- Source quality tracking
CREATE TABLE IF NOT EXISTS source_registry (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  trust_score     NUMERIC NOT NULL DEFAULT 5,
  bias_score      NUMERIC NOT NULL DEFAULT 5,
  last_validated_at TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_source_registry_url ON source_registry (url);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_registry ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by the pipeline)
CREATE POLICY "service_all_usage_tracking" ON usage_tracking
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_all_user_preferences" ON user_preferences
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_all_article_history" ON article_history
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_all_source_registry" ON source_registry
  FOR ALL USING (true) WITH CHECK (true);

-- Briefing/category overlay edited from Telegram (Python pipeline + breaking check)
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS briefing_overlay JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_preferences.briefing_overlay IS
  'Optional keys: boost_categories[], ignore_categories[], category_weights{}, tier1_keywords[], ignore_sources[], last_briefing_feedback';

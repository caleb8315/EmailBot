-- Per-purpose usage counters so chat can have its own daily cap.
ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS chat_calls_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pipeline_calls_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS digest_calls_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_calls_used INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN usage_tracking.chat_calls_used IS
  'Daily AI calls used by chat assistant endpoints';
COMMENT ON COLUMN usage_tracking.pipeline_calls_used IS
  'Daily AI calls used by pipeline article scoring';
COMMENT ON COLUMN usage_tracking.digest_calls_used IS
  'Daily AI calls used by daily/weekly digest synthesis';
COMMENT ON COLUMN usage_tracking.other_calls_used IS
  'Daily AI calls used by other AI features';

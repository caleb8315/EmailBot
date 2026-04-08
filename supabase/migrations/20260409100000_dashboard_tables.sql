-- Digest history (email + Telegram morning briefing content)
CREATE TABLE IF NOT EXISTS digest_archive (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  channels     TEXT[] NOT NULL DEFAULT '{}',
  subject      TEXT,
  html_body    TEXT,
  plain_text   TEXT NOT NULL DEFAULT '',
  article_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_digest_archive_created ON digest_archive (created_at DESC);

-- Pipeline / digest / dashboard log lines
CREATE TABLE IF NOT EXISTS system_events (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level      TEXT NOT NULL DEFAULT 'info',
  source     TEXT NOT NULL DEFAULT 'app',
  message    TEXT NOT NULL,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_level ON system_events (level);

ALTER TABLE digest_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_digest_archive" ON digest_archive
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_all_system_events" ON system_events
  FOR ALL USING (true) WITH CHECK (true);

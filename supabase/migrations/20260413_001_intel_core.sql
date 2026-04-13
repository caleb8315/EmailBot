-- ============================================================
-- JEFF INTELLIGENCE AGENT — Core Event & Entity Tables
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- CORE EVENT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS intel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  severity INTEGER,
  confidence FLOAT,
  location GEOGRAPHY(POINT),
  radius_km FLOAT,
  country_code TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  summary TEXT,
  raw_data JSONB,
  tags TEXT[],
  related_event_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intel_events_location ON intel_events USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_intel_events_timestamp ON intel_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_intel_events_source ON intel_events(source);
CREATE INDEX IF NOT EXISTS idx_intel_events_type ON intel_events(type);
CREATE INDEX IF NOT EXISTS idx_intel_events_country ON intel_events(country_code);
CREATE INDEX IF NOT EXISTS idx_intel_events_severity ON intel_events(severity DESC);

-- ============================================================
-- ENTITY REGISTRY
-- ============================================================
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  aliases TEXT[],
  entity_type TEXT NOT NULL,
  description TEXT,
  metadata JSONB,
  watch_priority TEXT DEFAULT 'normal',
  last_seen TIMESTAMPTZ,
  last_known_location GEOGRAPHY(POINT),
  last_known_heading FLOAT,
  last_known_speed FLOAT,
  tags TEXT[],
  related_entity_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_priority ON entities(watch_priority);

CREATE TABLE IF NOT EXISTS entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_a_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  entity_b_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  source TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_entity_rel_a ON entity_relationships(entity_a_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_b ON entity_relationships(entity_b_id);

CREATE TABLE IF NOT EXISTS entity_events (
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  event_id UUID REFERENCES intel_events(id) ON DELETE CASCADE,
  role TEXT,
  PRIMARY KEY (entity_id, event_id)
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE intel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_intel_events" ON intel_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_entities" ON entities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_entity_relationships" ON entity_relationships FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_entity_events" ON entity_events FOR ALL USING (true) WITH CHECK (true);

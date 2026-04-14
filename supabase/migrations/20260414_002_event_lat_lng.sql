-- Add explicit lat/lng columns to intel_events so we don't need WKB decoding.
ALTER TABLE intel_events ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE intel_events ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- Back-fill from the existing geography column.
UPDATE intel_events
SET lat = ST_Y(location::geometry),
    lng = ST_X(location::geometry)
WHERE location IS NOT NULL AND lat IS NULL;

CREATE INDEX IF NOT EXISTS idx_intel_events_lat_lng
  ON intel_events (lat, lng) WHERE lat IS NOT NULL;

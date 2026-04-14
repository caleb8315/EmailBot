import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';
import { getCountryFromPosition } from '../geo-utils';

/**
 * NASA EONET (Earth Observatory Natural Events Tracker) adapter.
 * Free, no API key, no registration. Provides geocoded natural events
 * including wildfires, volcanic eruptions, severe storms, iceberg activity.
 *
 * https://eonet.gsfc.nasa.gov/api/v3
 */

const CATEGORY_MAP: Record<string, { type: EventType; severity_base: number }> = {
  wildfires: { type: 'fire', severity_base: 60 },
  volcanoes: { type: 'earthquake', severity_base: 80 },
  severeStorms: { type: 'news_signal', severity_base: 55 },
  earthquakes: { type: 'earthquake', severity_base: 70 },
  floods: { type: 'news_signal', severity_base: 50 },
  landslides: { type: 'news_signal', severity_base: 55 },
  seaLakeIce: { type: 'news_signal', severity_base: 20 },
  snow: { type: 'news_signal', severity_base: 15 },
  drought: { type: 'news_signal', severity_base: 45 },
};

export class NASAEONETAdapter extends BaseAdapter {
  source: DataSource = 'firms'; // Group with NASA data
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    try {
      // Get currently active events
      const res = await this.safeFetch(
        'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100',
      );

      if (!res.ok) {
        this.warn(`NASA EONET returned ${res.status}`);
        return [];
      }

      const data = await res.json() as { events?: EONETEvent[] };
      if (!data.events) return [];

      const events: IntelEvent[] = [];

      for (const e of data.events) {
        const category = e.categories?.[0]?.id || 'unknown';
        const config = CATEGORY_MAP[category] || { type: 'news_signal' as EventType, severity_base: 40 };

        // EONET events can have multiple geometry points (tracking over time)
        const latestGeo = e.geometry?.[e.geometry.length - 1];
        if (!latestGeo?.coordinates) continue;

        const [lng, lat] = latestGeo.coordinates;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;

        // Events with many geometry points = long-running = higher importance
        const geoCount = e.geometry?.length || 1;
        const severity = Math.min(100, config.severity_base + Math.min(20, geoCount * 2));

        const tags = ['nasa', 'eonet', category];
        if (e.sources?.length) tags.push(...e.sources.map(s => s.id || '').filter(Boolean));

        events.push({
          source: 'firms',
          type: config.type,
          severity,
          confidence: 0.95,
          lat,
          lng,
          country_code: getCountryFromPosition(lat, lng),
          timestamp: latestGeo.date || new Date().toISOString(),
          title: `[EONET] ${e.title || category}`,
          summary: `Category: ${e.categories?.[0]?.title || category} | Tracking ${geoCount} positions | Sources: ${e.sources?.map(s => s.id).join(', ') || 'N/A'}`,
          tags,
          raw_data: {
            eonet_id: e.id,
            category,
            geometry_count: geoCount,
            first_seen: e.geometry?.[0]?.date,
            sources: e.sources?.map(s => ({ id: s.id, url: s.url })),
          },
        });
      }

      this.log(`Fetched ${events.length} active natural events`);
      return events;
    } catch (err) {
      this.error('NASA EONET fetch failed', err);
      return [];
    }
  }
}

interface EONETEvent {
  id: string;
  title?: string;
  categories?: { id: string; title: string }[];
  sources?: { id: string; url?: string }[];
  geometry?: {
    date: string;
    type: string;
    coordinates: [number, number];
  }[];
}

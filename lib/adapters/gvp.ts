import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

/**
 * Smithsonian GVP (Global Volcanism Program) via EONET volcanic events.
 * Tracks active volcanic eruptions and unrest globally.
 * Free, no API key required.
 */

function alertToSeverity(alertLevel: string | undefined): number {
  switch (alertLevel?.toLowerCase()) {
    case 'red': return 90;
    case 'orange': return 70;
    case 'yellow': return 50;
    case 'green': return 25;
    default: return 40;
  }
}

export class GVPAdapter extends BaseAdapter {
  source: DataSource = 'gvp';
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    if (!process.env.ENABLE_GVP) return [];

    try {
      const url = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=30';
      const res = await this.safeFetch(url);
      if (!res.ok) {
        this.warn(`GVP/EONET API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as EONETResponse;
      const events: IntelEvent[] = [];

      for (const event of data.events || []) {
        const geo = event.geometry?.[event.geometry.length - 1];
        if (!geo?.coordinates || geo.coordinates.length < 2) continue;

        const [lng, lat] = geo.coordinates;
        const severity = alertToSeverity(undefined);

        events.push({
          source: 'gvp' as DataSource,
          type: 'fire' as const,
          severity,
          confidence: 0.9,
          lat,
          lng,
          country_code: 'XX',
          timestamp: new Date(geo.date).toISOString(),
          title: `Volcanic Activity — ${event.title}`,
          summary: event.description || `Active volcanic event: ${event.title}`,
          tags: ['gvp', 'volcano', 'natural_hazard'],
          raw_data: {
            eonet_id: event.id,
            source_url: event.link || `https://eonet.gsfc.nasa.gov/api/v3/events/${event.id}`,
            geometry_count: event.geometry?.length,
            categories: event.categories?.map((c: { title: string }) => c.title),
          },
        });
      }

      this.log(`Fetched ${events.length} volcanic events from GVP/EONET`);
      return events;
    } catch (err) {
      this.error('GVP fetch failed', err);
      return [];
    }
  }
}

interface EONETResponse {
  events: {
    id: string;
    title: string;
    description?: string;
    link?: string;
    categories?: { title: string }[];
    geometry: { date: string; coordinates: number[] }[];
  }[];
}

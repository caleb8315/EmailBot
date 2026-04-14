import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

/**
 * USGS Earthquake adapter — real-time seismic events.
 * Free, no API key. Useful as high-confidence infrastructure events
 * and for baseline credibility of the whole system.
 */

function magToSeverity(magnitude: number): number {
  if (magnitude < 3) return 10;
  if (magnitude < 4.5) return 25;
  if (magnitude < 5.5) return 45;
  if (magnitude < 6.5) return 65;
  if (magnitude < 7.5) return 80;
  return 95;
}

export class USGSAdapter extends BaseAdapter {
  source: DataSource = 'usgs';
  fetchIntervalMinutes = 30;

  async fetch(): Promise<IntelEvent[]> {
    try {
      const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson';
      const res = await this.safeFetch(url);
      if (!res.ok) {
        this.warn(`USGS API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as USGSResponse;
      const events: IntelEvent[] = (data.features || []).map(f => {
        const [lng, lat, depth] = f.geometry.coordinates;
        const mag = f.properties.mag ?? 0;

        return {
          source: 'usgs' as DataSource,
          type: 'earthquake' as const,
          severity: magToSeverity(mag),
          confidence: 0.99,
          lat,
          lng,
          country_code: f.properties.place?.includes(',')
            ? 'XX'
            : 'XX',
          timestamp: new Date(f.properties.time).toISOString(),
          title: `M${mag.toFixed(1)} — ${f.properties.place || 'Unknown location'}`,
          summary: mag >= 6 ? `Major earthquake — magnitude ${mag.toFixed(1)}, ${depth.toFixed(0)}km deep` : mag >= 4.5 ? `Moderate earthquake — magnitude ${mag.toFixed(1)}, ${depth.toFixed(0)}km deep` : `Minor earthquake — magnitude ${mag.toFixed(1)}, ${depth.toFixed(0)}km deep`,
          tags: ['usgs', 'earthquake', mag >= 5 ? 'significant' : 'minor'],
          raw_data: {
            mag,
            depth,
            place: f.properties.place,
            tsunami: f.properties.tsunami,
            felt: f.properties.felt,
            alert: f.properties.alert,
            url: f.properties.url,
          },
        };
      });

      this.log(`Fetched ${events.length} earthquakes`);
      return events;
    } catch (err) {
      this.error('USGS fetch failed', err);
      return [];
    }
  }
}

interface USGSResponse {
  features: {
    properties: {
      mag: number;
      place: string;
      time: number;
      type?: string;
      tsunami?: number;
      felt?: number;
      alert?: string;
      url?: string;
    };
    geometry: { coordinates: [number, number, number] };
  }[];
}

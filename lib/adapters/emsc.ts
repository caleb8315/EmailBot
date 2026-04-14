import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

/**
 * EMSC (European-Mediterranean Seismological Centre) adapter.
 * Complements USGS with better European/Mediterranean coverage.
 * Free, no API key required.
 */

function magToSeverity(mag: number): number {
  if (mag < 3) return 10;
  if (mag < 4.5) return 25;
  if (mag < 5.5) return 45;
  if (mag < 6.5) return 65;
  if (mag < 7.5) return 80;
  return 95;
}

export class EMSCAdapter extends BaseAdapter {
  source: DataSource = 'emsc';
  fetchIntervalMinutes = 30;

  async fetch(): Promise<IntelEvent[]> {
    if (!process.env.ENABLE_EMSC) return [];

    try {
      const url = 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=50&minmag=3.5&orderby=time';
      const res = await this.safeFetch(url);
      if (!res.ok) {
        this.warn(`EMSC API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as { features: EMSCFeature[] };
      const events: IntelEvent[] = (data.features || []).map(f => {
        const mag = f.properties.mag ?? 0;
        const lat = f.properties.lat;
        const lng = f.properties.lon;
        const depth = f.properties.depth ?? 0;

        return {
          source: 'emsc' as DataSource,
          type: 'earthquake' as const,
          severity: magToSeverity(mag),
          confidence: 0.95,
          lat,
          lng,
          country_code: f.properties.flynn_region?.includes(',') ? 'XX' : 'XX',
          timestamp: new Date(f.properties.time).toISOString(),
          title: `M${mag.toFixed(1)} — ${f.properties.flynn_region || 'Unknown location'}`,
          summary: `Earthquake magnitude ${mag.toFixed(1)}, ${depth.toFixed(0)}km deep — ${f.properties.flynn_region || 'location unknown'}`,
          tags: ['emsc', 'earthquake', mag >= 5 ? 'significant' : 'minor'],
          raw_data: {
            mag,
            depth,
            place: f.properties.flynn_region,
            source_url: f.properties.lastupdate ? `https://www.emsc-csem.org/Earthquake/earthquake.php?id=${f.id}` : undefined,
            unid: f.id,
            auth: f.properties.auth,
          },
        };
      });

      this.log(`Fetched ${events.length} earthquakes from EMSC`);
      return events;
    } catch (err) {
      this.error('EMSC fetch failed', err);
      return [];
    }
  }
}

interface EMSCFeature {
  id: string;
  properties: {
    time: string;
    mag: number;
    lat: number;
    lon: number;
    depth: number;
    flynn_region?: string;
    auth?: string;
    lastupdate?: string;
  };
}

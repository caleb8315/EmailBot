import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

/**
 * ReliefWeb Disasters feed — tracks global humanitarian crises.
 * Free, no API key required.
 * Covers floods, cyclones, earthquakes, epidemics, conflicts, etc.
 */

function disasterToSeverity(status: string | undefined, type: string | undefined): number {
  if (status === 'alert') return 80;
  if (status === 'ongoing') return 60;
  if (type?.toLowerCase().includes('earthquake') || type?.toLowerCase().includes('cyclone')) return 70;
  if (type?.toLowerCase().includes('epidemic') || type?.toLowerCase().includes('flood')) return 65;
  return 45;
}

export class ReliefWebDisastersAdapter extends BaseAdapter {
  source: DataSource = 'reliefweb';
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    if (!process.env.ENABLE_RELIEFWEB) return [];

    try {
      const url = 'https://api.reliefweb.int/v1/disasters?appname=jeff-intel&limit=30&sort[]=date:desc&fields[include][]=name&fields[include][]=description&fields[include][]=date&fields[include][]=status&fields[include][]=type&fields[include][]=country&fields[include][]=url';
      const res = await this.safeFetch(url);
      if (!res.ok) {
        this.warn(`ReliefWeb API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as RWResponse;
      const events: IntelEvent[] = [];

      for (const item of data.data || []) {
        const fields = item.fields;
        if (!fields) continue;

        const countries = fields.country || [];
        const countryCode = countries[0]?.iso3 || 'XX';
        const types = fields.type || [];
        const typeName = types[0]?.name;
        const severity = disasterToSeverity(fields.status, typeName);

        events.push({
          source: 'reliefweb' as DataSource,
          type: 'news_signal' as const,
          severity,
          confidence: 0.9,
          lat: 0,
          lng: 0,
          country_code: countryCode.slice(0, 2).toUpperCase(),
          timestamp: new Date(fields.date?.created || Date.now()).toISOString(),
          title: fields.name || 'Unknown disaster',
          summary: (fields.description || '').slice(0, 500),
          tags: ['reliefweb', 'humanitarian', ...(typeName ? [typeName.toLowerCase()] : [])],
          raw_data: {
            source_url: fields.url || `https://reliefweb.int/disaster/${item.id}`,
            status: fields.status,
            disaster_type: typeName,
            countries: countries.map((c: { name: string }) => c.name),
          },
        });
      }

      this.log(`Fetched ${events.length} disasters from ReliefWeb`);
      return events;
    } catch (err) {
      this.error('ReliefWeb fetch failed', err);
      return [];
    }
  }
}

interface RWResponse {
  data: {
    id: string;
    fields: {
      name?: string;
      description?: string;
      date?: { created: string };
      status?: string;
      type?: { name: string }[];
      country?: { name: string; iso3: string }[];
      url?: string;
    };
  }[];
}

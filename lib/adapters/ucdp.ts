import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';

/**
 * UCDP (Uppsala Conflict Data Program) adapter.
 * Geocoded conflict events — battles, bombings, state violence — with exact lat/lng.
 * This is the best free ACLED alternative.
 *
 * API: https://ucdpapi.pcr.uu.se/api/gedevents/25.1
 * Requires x-ucdp-access-token header (free, request from UCDP).
 * Without token: falls back to their candidate events feed.
 */

const UCDP_TYPE_MAP: Record<number, { type: EventType; label: string }> = {
  1: { type: 'conflict', label: 'State-based conflict' },
  2: { type: 'conflict', label: 'Non-state conflict' },
  3: { type: 'conflict', label: 'One-sided violence' },
};

function deathsToSeverity(deaths: number): number {
  if (deaths === 0) return 25;
  if (deaths <= 5) return 50;
  if (deaths <= 25) return 70;
  if (deaths <= 100) return 85;
  return 95;
}

export class UCDPAdapter extends BaseAdapter {
  source: DataSource = 'acled'; // Use acled source type for compatibility with rules engine
  fetchIntervalMinutes = 120;

  async fetch(): Promise<IntelEvent[]> {
    const token = process.env.UCDP_API_TOKEN;

    if (token) {
      return this.fetchFromAPI(token);
    }

    // Without token, try the candidate events or GED download
    return this.fetchFromCandidates();
  }

  private async fetchFromAPI(token: string): Promise<IntelEvent[]> {
    try {
      // GED events — the full geocoded dataset
      const res = await this.safeFetch(
        'https://ucdpapi.pcr.uu.se/api/gedevents/25.1?pagesize=200&OrderBy=date_start&Order=desc',
        { headers: { 'x-ucdp-access-token': token } },
      );

      if (!res.ok) {
        this.warn(`UCDP API returned ${res.status}`);
        return this.fetchFromCandidates();
      }

      const data = await res.json() as { Result?: UCDPEvent[] };
      if (!data.Result) return [];

      return this.normalizeEvents(data.Result);
    } catch (err) {
      this.error('UCDP API fetch failed', err);
      return [];
    }
  }

  private async fetchFromCandidates(): Promise<IntelEvent[]> {
    try {
      // Candidate events are more recent and may not require full token
      const res = await this.safeFetch(
        'https://ucdpapi.pcr.uu.se/api/gedevents/candidates?pagesize=100',
        { headers: process.env.UCDP_API_TOKEN ? { 'x-ucdp-access-token': process.env.UCDP_API_TOKEN } : {} },
      );

      if (!res.ok) {
        this.warn(`UCDP candidates returned ${res.status} — token may be required. Request one from UCDP.`);
        return [];
      }

      const data = await res.json() as { Result?: UCDPEvent[] };
      if (!data.Result) return [];

      return this.normalizeEvents(data.Result);
    } catch (err) {
      this.error('UCDP candidates fetch failed', err);
      return [];
    }
  }

  private normalizeEvents(events: UCDPEvent[]): IntelEvent[] {
    return events
      .filter(e => e.latitude && e.longitude)
      .map(e => {
        const typeInfo = UCDP_TYPE_MAP[e.type_of_violence] || { type: 'conflict' as EventType, label: 'Armed conflict' };
        const deaths = (e.best || 0);
        const severity = deathsToSeverity(deaths);

        const tags = ['ucdp', 'conflict', 'geocoded'];
        if (e.country) tags.push(e.country.toLowerCase().replace(/\s+/g, '_'));
        if (deaths > 0) tags.push('fatal');
        if (e.type_of_violence === 3) tags.push('one_sided_violence');
        if (e.side_a) tags.push(e.side_a.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30));

        // Classify as airstrike if description mentions it
        const desc = (e.source_article || '').toLowerCase();
        let eventType = typeInfo.type;
        if (/airstrike|air strike|bomb(ing|ed)|aerial|drone strike|shelling/.test(desc)) {
          eventType = 'airstrike';
        }

        return {
          source: 'acled' as DataSource,
          type: eventType,
          severity,
          confidence: 0.9,
          lat: parseFloat(String(e.latitude)),
          lng: parseFloat(String(e.longitude)),
          country_code: e.country_id || (e.country || '').substring(0, 2).toUpperCase(),
          timestamp: e.date_start ? new Date(e.date_start).toISOString() : new Date().toISOString(),
          title: `${typeInfo.label}: ${e.side_a || '?'} vs ${e.side_b || '?'} — ${e.where_description || e.country || 'Unknown'}`,
          summary: `Deaths: ${deaths} (est ${e.low || 0}–${e.high || 0}) | ${e.source_article?.slice(0, 300) || 'No details'}`,
          tags,
          raw_data: {
            ucdp_id: e.id,
            side_a: e.side_a,
            side_b: e.side_b,
            deaths_best: e.best,
            deaths_low: e.low,
            deaths_high: e.high,
            country: e.country,
            region: e.region,
            where: e.where_description,
            type_of_violence: e.type_of_violence,
          },
        };
      });
  }
}

interface UCDPEvent {
  id?: number;
  year?: number;
  type_of_violence: number;
  conflict_name?: string;
  side_a?: string;
  side_b?: string;
  country?: string;
  country_id?: string;
  region?: string;
  latitude: number;
  longitude: number;
  where_description?: string;
  date_start?: string;
  date_end?: string;
  best?: number;
  low?: number;
  high?: number;
  source_article?: string;
  geom_wkt?: string;
}

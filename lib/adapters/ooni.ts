import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

/**
 * OONI (Open Observatory of Network Interference) adapter.
 * Detects internet censorship and shutdowns worldwide.
 * Free API, no key needed.
 */
export class OONIAdapter extends BaseAdapter {
  source: DataSource = 'ooni';
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await this.safeFetch(
        `https://api.ooni.io/api/v1/incidents/search?since=${since}&only_ongoing=true`,
      );

      if (!res.ok) {
        this.warn(`OONI API returned ${res.status}`);
        return this.fetchFallback();
      }

      const data = await res.json() as { incidents?: OONIIncident[] };
      if (!data.incidents) return this.fetchFallback();

      const events: IntelEvent[] = data.incidents.map(inc => ({
        source: 'ooni' as DataSource,
        type: inc.test_name?.includes('web_connectivity')
          ? 'internet_disruption' as const
          : 'internet_shutdown' as const,
        severity: this.scoreSeverity(inc),
        confidence: 0.8,
        lat: 0,
        lng: 0,
        country_code: inc.probe_cc || 'XX',
        timestamp: inc.start_time || new Date().toISOString(),
        title: `Internet disruption in ${inc.probe_cc}: ${inc.short_description || inc.test_name || 'Unknown'}`,
        summary: (inc.short_description || '').slice(0, 500),
        tags: ['ooni', 'internet', inc.test_name || 'unknown'],
        raw_data: inc as unknown as Record<string, unknown>,
      }));

      this.log(`Found ${events.length} internet disruption incidents`);
      return events;
    } catch (err) {
      this.error('OONI fetch failed', err);
      return [];
    }
  }

  private async fetchFallback(): Promise<IntelEvent[]> {
    // Fallback: check OONI measurements for high anomaly rates
    try {
      const res = await this.safeFetch(
        'https://api.ooni.io/api/v1/aggregation?since=2024-01-01&axis_x=measurement_start_day&axis_y=probe_cc&test_name=web_connectivity',
      );
      if (!res.ok) return [];
      // Basic fallback — return empty for now
      return [];
    } catch {
      return [];
    }
  }

  private scoreSeverity(incident: OONIIncident): number {
    let score = 50;
    if (incident.test_name === 'signal' || incident.test_name === 'whatsapp') score += 15;
    if (incident.test_name === 'tor') score += 20;
    const desc = (incident.short_description || '').toLowerCase();
    if (desc.includes('total') || desc.includes('complete')) score += 25;
    if (desc.includes('partial')) score += 10;
    return Math.min(100, score);
  }
}

interface OONIIncident {
  probe_cc?: string;
  test_name?: string;
  short_description?: string;
  start_time?: string;
  end_time?: string;
}

import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';
import { getCountryFromPosition } from '../geo-utils';

/**
 * NASA FIRMS (Fire Information for Resource Management System) adapter.
 * Free, no API key needed for the open CSV feed.
 * Detects thermal anomalies — useful for wildfire and conflict-zone
 * fire events (airstrikes often produce thermal signatures).
 */
export class FIRMSAdapter extends BaseAdapter {
  source: DataSource = 'firms';
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    try {
      // FIRMS VIIRS active fire data — last 24 hours, CSV format
      // No API key needed for the global summary
      const url =
        'https://firms.modaps.eosdis.nasa.gov/api/area/csv/' +
        (process.env.FIRMS_MAP_KEY || 'GLOBAL') +
        '/VIIRS_SNPP_NRT/world/1';

      const res = await this.safeFetch(url);
      if (!res.ok) {
        // Fall back to the open summary endpoint
        return this.fetchFromOpenSummary();
      }

      const csv = await res.text();
      return this.parseCSV(csv);
    } catch (err) {
      this.error('FIRMS fetch failed, trying fallback', err);
      return this.fetchFromOpenSummary();
    }
  }

  private async fetchFromOpenSummary(): Promise<IntelEvent[]> {
    try {
      const url = 'https://firms.modaps.eosdis.nasa.gov/api/country/csv/GLOBAL/VIIRS_SNPP_NRT/world/1';
      const res = await this.safeFetch(url);
      if (!res.ok) {
        this.warn(`FIRMS fallback returned ${res.status}`);
        return [];
      }
      return this.parseCSV(await res.text());
    } catch (err) {
      this.error('FIRMS fallback also failed', err);
      return [];
    }
  }

  private parseCSV(csv: string): IntelEvent[] {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];

    const header = lines[0].toLowerCase().split(',');
    const latIdx = header.indexOf('latitude');
    const lngIdx = header.indexOf('longitude');
    const brightIdx = header.indexOf('bright_ti4');
    const dateIdx = header.indexOf('acq_date');
    const timeIdx = header.indexOf('acq_time');
    const confIdx = header.indexOf('confidence');
    const frpIdx = header.indexOf('frp');

    if (latIdx === -1 || lngIdx === -1) {
      this.warn('Unexpected FIRMS CSV format');
      return [];
    }

    const events: IntelEvent[] = [];
    // Only take high-FRP (fire radiative power) events to stay within row budget
    const significantLines = lines.slice(1).filter(line => {
      const cols = line.split(',');
      const frp = parseFloat(cols[frpIdx] || '0');
      return frp > 50; // Filter to significant thermal events only
    });

    // Cap at 100 events per fetch to manage row budget
    for (const line of significantLines.slice(0, 100)) {
      const cols = line.split(',');
      const lat = parseFloat(cols[latIdx]);
      const lng = parseFloat(cols[lngIdx]);
      const brightness = parseFloat(cols[brightIdx] || '0');
      const frp = parseFloat(cols[frpIdx] || '0');
      const conf = cols[confIdx] || 'nominal';
      const date = cols[dateIdx] || '';
      const time = cols[timeIdx] || '0000';

      if (isNaN(lat) || isNaN(lng)) continue;

      const severity = Math.min(100, Math.round(frp / 5));

      events.push({
        source: 'firms',
        type: 'fire',
        severity,
        confidence: conf === 'high' ? 0.9 : conf === 'nominal' ? 0.7 : 0.5,
        lat,
        lng,
        country_code: getCountryFromPosition(lat, lng),
        timestamp: date
          ? `${date}T${time.padStart(4, '0').substring(0, 2)}:${time.padStart(4, '0').substring(2)}:00Z`
          : new Date().toISOString(),
        title: `Thermal anomaly — FRP ${frp.toFixed(0)}MW`,
        summary: frp > 200 ? 'Major thermal event — likely large wildfire or industrial fire' : frp > 100 ? 'Significant heat source detected by satellite' : 'Moderate thermal anomaly detected by satellite',
        tags: ['firms', 'thermal', 'fire', frp > 200 ? 'high_frp' : 'moderate_frp'],
        raw_data: { brightness, frp, confidence: conf, date, time },
      });
    }

    this.log(`Parsed ${events.length} significant thermal events`);
    return events;
  }
}

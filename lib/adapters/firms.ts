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
    const sensors = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT'];
    const allEvents: IntelEvent[] = [];

    for (const sensor of sensors) {
      try {
        // FIRMS VIIRS active fire data — last 24 hours, CSV format.
        // The "GLOBAL" token keeps this fully free if no map key is set.
        const url =
          'https://firms.modaps.eosdis.nasa.gov/api/area/csv/' +
          (process.env.FIRMS_MAP_KEY || 'GLOBAL') +
          `/${sensor}/world/1`;

        const res = await this.safeFetch(url);
        if (!res.ok) {
          allEvents.push(...await this.fetchFromOpenSummary(sensor));
          continue;
        }
        allEvents.push(...this.parseCSV(await res.text(), sensor));
      } catch (err) {
        this.error(`FIRMS ${sensor} fetch failed, trying fallback`, err);
        allEvents.push(...await this.fetchFromOpenSummary(sensor));
      }
    }

    // Deduplicate cross-sensor overlaps at near-identical coordinates/timestamps.
    const deduped = new Map<string, IntelEvent>();
    for (const event of allEvents) {
      const ts = new Date(event.timestamp);
      const hourBucket = Number.isFinite(ts.getTime()) ? Math.floor(ts.getTime() / (60 * 60 * 1000)) : 0;
      const key = `${event.country_code}|${event.lat.toFixed(3)}|${event.lng.toFixed(3)}|${hourBucket}`;
      const existing = deduped.get(key);
      if (!existing || event.severity > existing.severity) deduped.set(key, event);
    }

    const merged = [...deduped.values()]
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 180);
    this.log(`Merged ${allEvents.length} thermal points → ${merged.length} unique events`);
    return merged;
  }

  private async fetchFromOpenSummary(sensor: string): Promise<IntelEvent[]> {
    try {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/country/csv/GLOBAL/${sensor}/world/1`;
      const res = await this.safeFetch(url);
      if (!res.ok) {
        this.warn(`FIRMS ${sensor} fallback returned ${res.status}`);
        return [];
      }
      return this.parseCSV(await res.text(), sensor);
    } catch (err) {
      this.error(`FIRMS ${sensor} fallback also failed`, err);
      return [];
    }
  }

  private parseCSV(csv: string, sensor: string): IntelEvent[] {
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
    const hotspotCountries = new Set([
      'UA', 'RU', 'SY', 'IQ', 'YE', 'IL', 'IR', 'LB', 'SD', 'MM', 'AF', 'SO', 'CD',
    ]);

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

      const countryCode = getCountryFromPosition(lat, lng);
      const hour = parseInt(time.padStart(4, '0').slice(0, 2), 10);
      const isNight = Number.isFinite(hour) ? (hour >= 18 || hour <= 5) : false;
      const looksLikeStrikeSignature =
        frp >= 220 &&
        conf !== 'low' &&
        isNight &&
        hotspotCountries.has(countryCode);

      const severity = Math.min(100, Math.round(frp / 4.5) + (looksLikeStrikeSignature ? 8 : 0));
      const confidence =
        looksLikeStrikeSignature ? 0.86 :
        conf === 'high' ? 0.9 :
        conf === 'nominal' ? 0.72 :
        0.55;
      const title = looksLikeStrikeSignature
        ? `Possible strike thermal signature — FRP ${frp.toFixed(0)}MW`
        : `Thermal anomaly — FRP ${frp.toFixed(0)}MW`;
      const summary = looksLikeStrikeSignature
        ? 'High-intensity nighttime thermal event in conflict-prone region. Requires corroboration with other sources.'
        : frp > 200
          ? 'Major thermal event — likely large wildfire or industrial fire'
          : frp > 100
            ? 'Significant heat source detected by satellite'
            : 'Moderate thermal anomaly detected by satellite';
      const tags = [
        'firms',
        'satellite',
        'thermal',
        'fire',
        'free_satellite',
        sensor.toLowerCase(),
        frp > 200 ? 'high_frp' : 'moderate_frp',
      ];
      if (looksLikeStrikeSignature) tags.push('possible_strike_signature');

      events.push({
        source: 'firms',
        type: 'fire',
        severity,
        confidence,
        lat,
        lng,
        country_code: countryCode,
        timestamp: date
          ? `${date}T${time.padStart(4, '0').substring(0, 2)}:${time.padStart(4, '0').substring(2)}:00Z`
          : new Date().toISOString(),
        title,
        summary,
        tags,
        raw_data: {
          brightness,
          frp,
          confidence: conf,
          date,
          time,
          hour_utc: Number.isFinite(hour) ? hour : null,
          night_detection: isNight,
          possible_strike_signature: looksLikeStrikeSignature,
          sensor,
        },
      });
    }

    this.log(`Parsed ${events.length} significant thermal events from ${sensor}`);
    return events;
  }
}

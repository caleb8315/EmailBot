import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';
import { execSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * GDELT Events 2.0 raw export adapter.
 * Downloads the 15-minute CSV export, parses it for conflict/military events
 * with exact lat/lng coordinates. Free, no API key, no registration.
 *
 * CAMEO codes: https://www.gdeltproject.org/data/lookups/CAMEO.eventcodes.txt
 * 190=military force, 193=small arms, 194=artillery, 195=aerial weapons, etc.
 */

// CAMEO root codes that indicate conflict/military action
const CONFLICT_CAMEO: Record<string, { type: EventType; label: string; severity: number }> = {
  '183': { type: 'airstrike', label: 'Suicide bombing', severity: 90 },
  '184': { type: 'airstrike', label: 'Chemical weapons', severity: 95 },
  '185': { type: 'airstrike', label: 'Explosive device/IED', severity: 80 },
  '186': { type: 'conflict', label: 'Assassination', severity: 85 },
  '190': { type: 'conflict', label: 'Military force used', severity: 70 },
  '191': { type: 'conflict', label: 'Blockade imposed', severity: 60 },
  '192': { type: 'conflict', label: 'Territory occupied', severity: 75 },
  '193': { type: 'conflict', label: 'Small arms fighting', severity: 65 },
  '194': { type: 'airstrike', label: 'Artillery/tank fire', severity: 80 },
  '195': { type: 'airstrike', label: 'Aerial weapons/bombing', severity: 85 },
  '196': { type: 'conflict', label: 'Ceasefire violated', severity: 70 },
  '200': { type: 'conflict', label: 'Mass violence', severity: 90 },
  '201': { type: 'conflict', label: 'Mass expulsion', severity: 85 },
  '202': { type: 'conflict', label: 'Ethnic cleansing', severity: 95 },
  '203': { type: 'airstrike', label: 'WMD used', severity: 100 },
  '145': { type: 'protest', label: 'Violent protest/riot', severity: 50 },
  '180': { type: 'conflict', label: 'Assault', severity: 55 },
  '181': { type: 'conflict', label: 'Abduction/hijacking', severity: 60 },
  '182': { type: 'conflict', label: 'Physical assault', severity: 55 },
};

// GDELT export columns (tab-separated, 58+ columns)
const COL = {
  GLOBALEVENTID: 0,
  SQLDATE: 1,
  Actor1CountryCode: 7,
  Actor2CountryCode: 17,
  EventCode: 26,
  EventRootCode: 27,
  GoldsteinScale: 30,
  NumArticles: 33,
  ActionGeo_CountryCode: 53,
  ActionGeo_Lat: 56,
  ActionGeo_Long: 57,
  SOURCEURL: 60,
  ActionGeo_FullName: 52,
};

export class GDELTEventsAdapter extends BaseAdapter {
  source: DataSource = 'gdelt';
  fetchIntervalMinutes = 15;

  async fetch(): Promise<IntelEvent[]> {
    try {
      // Get the latest export file URL
      const updateRes = await this.safeFetch('http://data.gdeltproject.org/gdeltv2/lastupdate.txt');
      if (!updateRes.ok) return [];

      const text = await updateRes.text();
      const exportLine = text.trim().split('\n').find(l => l.includes('.export.CSV'));
      if (!exportLine) return [];

      const zipUrl = exportLine.split(' ').pop()?.trim();
      if (!zipUrl) return [];

      // Download and unzip
      const tmpDir = '/tmp';
      const zipPath = join(tmpDir, 'gdelt_events.zip');

      try {
        execSync(`curl -sL "${zipUrl}" -o "${zipPath}"`, { timeout: 20000 });
        execSync(`cd "${tmpDir}" && unzip -o "${zipPath}" 2>/dev/null`, { timeout: 10000 });
      } catch {
        this.warn('Failed to download/unzip GDELT export');
        return [];
      }

      // Find the CSV file
      const csvName = zipUrl.split('/').pop()?.replace('.zip', '') || '';
      const csvPath = join(tmpDir, csvName);
      if (!existsSync(csvPath)) {
        this.warn('GDELT CSV not found after unzip');
        return [];
      }

      const csv = readFileSync(csvPath, 'utf-8');
      const events = this.parseEvents(csv);

      // Cleanup
      try { unlinkSync(zipPath); } catch {}
      try { unlinkSync(csvPath); } catch {}

      this.log(`Parsed ${events.length} conflict events from GDELT export`);
      return events;
    } catch (err) {
      this.error('GDELT events export failed', err);
      return [];
    }
  }

  private parseEvents(csv: string): IntelEvent[] {
    const lines = csv.trim().split('\n');
    const events: IntelEvent[] = [];

    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 58) continue;

      const eventCode = cols[COL.EventCode] || '';
      const rootCode = cols[COL.EventRootCode] || '';

      // Only process conflict/military events
      const match = CONFLICT_CAMEO[eventCode] || CONFLICT_CAMEO[rootCode];
      if (!match) continue;

      const lat = parseFloat(cols[COL.ActionGeo_Lat]);
      const lng = parseFloat(cols[COL.ActionGeo_Long]);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;

      const countryCode = (cols[COL.ActionGeo_CountryCode] || 'XX').substring(0, 2);
      const goldstein = parseFloat(cols[COL.GoldsteinScale] || '0');
      const numArticles = parseInt(cols[COL.NumArticles] || '1', 10);
      const locationName = cols[COL.ActionGeo_FullName] || '';
      const sourceUrl = cols[COL.SOURCEURL] || '';
      const dateStr = cols[COL.SQLDATE] || '';

      // Boost severity based on number of articles covering this event
      const severity = Math.min(100, match.severity + Math.min(15, numArticles * 2));

      const actor1 = cols[COL.Actor1CountryCode] || '?';
      const actor2 = cols[COL.Actor2CountryCode] || '?';

      const tags = ['gdelt', 'conflict', 'geocoded', match.type];
      if (countryCode !== 'XX') tags.push(countryCode.toLowerCase());

      events.push({
        source: 'gdelt',
        type: match.type,
        severity,
        confidence: 0.65,
        lat,
        lng,
        country_code: countryCode,
        timestamp: dateStr.length === 8
          ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T00:00:00Z`
          : new Date().toISOString(),
        title: `${match.label}: ${locationName || countryCode}`,
        summary: `${actor1} → ${actor2} | Goldstein: ${goldstein} | Sources: ${numArticles} | ${sourceUrl.slice(0, 200)}`,
        tags,
        raw_data: {
          event_id: cols[COL.GLOBALEVENTID],
          cameo_code: eventCode,
          goldstein,
          num_articles: numArticles,
          actor1: cols[7],
          actor2: cols[17],
          source_url: sourceUrl,
          location: locationName,
        },
      });
    }

    return events;
  }
}

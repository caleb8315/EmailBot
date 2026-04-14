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

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', USA: 'United States', GB: 'United Kingdom', GBR: 'United Kingdom',
  UK: 'United Kingdom', RU: 'Russia', RUS: 'Russia', CN: 'China', CHN: 'China',
  UA: 'Ukraine', UKR: 'Ukraine', IR: 'Iran', IRN: 'Iran', IL: 'Israel', ISR: 'Israel',
  SY: 'Syria', SYR: 'Syria', IQ: 'Iraq', IRQ: 'Iraq', AF: 'Afghanistan', AFG: 'Afghanistan',
  YE: 'Yemen', YEM: 'Yemen', SD: 'Sudan', SDN: 'Sudan', MM: 'Myanmar', MMR: 'Myanmar',
  KP: 'North Korea', PRK: 'North Korea', TW: 'Taiwan', TWN: 'Taiwan',
  SA: 'Saudi Arabia', SAU: 'Saudi Arabia', PK: 'Pakistan', PAK: 'Pakistan',
  LB: 'Lebanon', LBN: 'Lebanon', LY: 'Libya', LBY: 'Libya', ET: 'Ethiopia', ETH: 'Ethiopia',
  NG: 'Nigeria', NGA: 'Nigeria', SO: 'Somalia', SOM: 'Somalia', CD: 'DR Congo',
  FR: 'France', FRA: 'France', DE: 'Germany', DEU: 'Germany',
  JP: 'Japan', JPN: 'Japan', KR: 'South Korea', KOR: 'South Korea',
  IN: 'India', IND: 'India', BR: 'Brazil', BRA: 'Brazil',
  PL: 'Poland', POL: 'Poland', EE: 'Estonia', EST: 'Estonia',
  PSE: 'Palestine', ISL: 'Islamic State', GOV: 'Government', MIL: 'Military',
  REB: 'Rebels', OPP: 'Opposition', COP: 'Police', CVL: 'Civilians',
};

// Domains that produce false conflict events (movies, games, sports, fiction)
const JUNK_DOMAINS = [
  'collider.com', 'imdb.com', 'rottentomatoes.com', 'screenrant.com', 'ign.com',
  'gamespot.com', 'kotaku.com', 'polygon.com', 'thegamer.com', 'pcgamer.com',
  'espn.com', 'bleacherreport.com', 'sports.yahoo.com', 'cbssports.com',
  'people.com', 'tmz.com', 'eonline.com', 'usmagazine.com', 'pagesix.com',
  'buzzfeed.com', 'boredpanda.com', 'distractify.com', 'ranker.com',
  'wikipedia.org', 'fandom.com', 'tvtropes.org', 'goodreads.com',
  'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com',
  'weather.com', 'accuweather.com',
  'tiktok.com', 'instagram.com', 'pinterest.com', 'reddit.com',
  'youtube.com', 'twitch.tv', 'dailymotion.com',
];

// URL patterns that indicate non-news content
const JUNK_URL_PATTERNS = [
  /\/movie/i, /\/film/i, /\/review/i, /\/trailer/i, /\/game/i, /\/gaming/i,
  /\/recipe/i, /\/horoscope/i, /\/celebrity/i, /\/entertainment/i,
  /\/sport/i, /\/score/i, /\/fantasy-football/i,
  /best-.*-movies/i, /top-\d+/i, /listicle/i, /\/gallery/i,
  /\/book-review/i, /\/tv-show/i, /\/streaming/i,
];

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
      const sourceUrl = (cols[COL.SOURCEURL] || '').toLowerCase();
      const dateStr = cols[COL.SQLDATE] || '';

      // Filter out junk sources — entertainment, movies, sports, fiction, listicles
      const domain = sourceUrl.replace(/^https?:\/\//, '').split('/')[0];
      if (JUNK_DOMAINS.some(d => domain.includes(d))) continue;
      if (JUNK_URL_PATTERNS.some(p => p.test(sourceUrl))) continue;

      // Require multiple source articles for high-severity claims to reduce false positives
      if (match.severity >= 80 && numArticles < 3) continue;
      if (match.severity >= 70 && numArticles < 2) continue;

      // Boost severity based on number of articles covering this event
      const severity = Math.min(100, match.severity + Math.min(15, numArticles * 2));

      const actor1Name = cols[7] || '';
      const actor2Name = cols[17] || '';

      const tags = ['gdelt', 'conflict', 'geocoded', match.type];
      if (countryCode !== 'XX') tags.push(countryCode.toLowerCase());

      // Build a human-readable title
      const location = locationName || COUNTRY_NAMES[countryCode] || countryCode;
      const title = `${match.label} in ${location}`;

      // Build a human-readable summary
      const parts: string[] = [];
      if (actor1Name && actor2Name && actor1Name !== actor2Name) {
        parts.push(`${COUNTRY_NAMES[actor1Name] || actor1Name} vs ${COUNTRY_NAMES[actor2Name] || actor2Name}`);
      }
      parts.push(`Reported by ${numArticles} source${numArticles > 1 ? 's' : ''}`);
      if (goldstein <= -8) parts.push('Extremely hostile');
      else if (goldstein <= -5) parts.push('Highly conflictual');
      else if (goldstein <= -2) parts.push('Tense situation');

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
        title,
        summary: parts.join(' · '),
        tags,
        raw_data: {
          event_id: cols[COL.GLOBALEVENTID],
          cameo_code: eventCode,
          goldstein,
          num_articles: numArticles,
          source_url: sourceUrl,
          location: locationName,
        },
      });
    }

    return events;
  }
}

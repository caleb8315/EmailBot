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

// CAMEO event codes — specific sub-codes first, then root codes as fallback.
// Match logic tries eventCode first (most specific), then rootCode.
const CONFLICT_CAMEO: Record<string, { type: EventType; label: string; severity: number }> = {
  // 14x — Protests
  '141': { type: 'protest', label: 'Political protest', severity: 40 },
  '1411': { type: 'protest', label: 'Anti-government protest', severity: 45 },
  '1414': { type: 'protest', label: 'Pro-rights demonstration', severity: 35 },
  '142': { type: 'protest', label: 'Hunger strike', severity: 40 },
  '143': { type: 'protest', label: 'Strike or boycott', severity: 40 },
  '1431': { type: 'protest', label: 'Workers' strike', severity: 40 },
  '144': { type: 'protest', label: 'Obstruction / blockade protest', severity: 45 },
  '145': { type: 'protest', label: 'Violent protest / riot', severity: 50 },
  '1451': { type: 'protest', label: 'Violent street riot', severity: 55 },
  '1452': { type: 'protest', label: 'Violent mob attack', severity: 60 },

  // 17x — Coercion
  '171': { type: 'conflict', label: 'Seized or damaged property', severity: 50 },
  '1711': { type: 'conflict', label: 'Confiscated property', severity: 50 },
  '1712': { type: 'conflict', label: 'Destroyed property', severity: 55 },
  '172': { type: 'conflict', label: 'Military buildup', severity: 55 },
  '1721': { type: 'conflict', label: 'Troops deployed to border', severity: 60 },
  '173': { type: 'conflict', label: 'Imposed curfew', severity: 45 },
  '174': { type: 'conflict', label: 'Arrested or detained', severity: 50 },
  '1741': { type: 'conflict', label: 'Mass arrests', severity: 55 },

  // 18x — Assault
  '180': { type: 'conflict', label: 'Violent assault', severity: 55 },
  '181': { type: 'conflict', label: 'Abduction / hostage taking', severity: 60 },
  '1811': { type: 'conflict', label: 'Kidnapping', severity: 65 },
  '1812': { type: 'conflict', label: 'Hostage crisis', severity: 70 },
  '1813': { type: 'conflict', label: 'Hijacking', severity: 70 },
  '182': { type: 'conflict', label: 'Physical assault', severity: 55 },
  '1821': { type: 'conflict', label: 'Sexually violent attack', severity: 65 },
  '1822': { type: 'conflict', label: 'Torture', severity: 70 },
  '1823': { type: 'conflict', label: 'Attack by mob / lynching', severity: 65 },
  '183': { type: 'airstrike', label: 'Suicide bombing', severity: 90 },
  '184': { type: 'airstrike', label: 'Chemical weapons attack', severity: 95 },
  '1841': { type: 'airstrike', label: 'Chemical gas attack', severity: 95 },
  '1842': { type: 'airstrike', label: 'Biological weapons attack', severity: 95 },
  '185': { type: 'airstrike', label: 'Car bomb / IED explosion', severity: 80 },
  '1851': { type: 'airstrike', label: 'Roadside IED attack', severity: 80 },
  '1852': { type: 'airstrike', label: 'Car bomb detonated', severity: 85 },
  '186': { type: 'conflict', label: 'Targeted assassination', severity: 85 },

  // 19x — Military force
  '190': { type: 'conflict', label: 'Military action', severity: 70 },
  '1901': { type: 'conflict', label: 'Troops deployed', severity: 65 },
  '1902': { type: 'conflict', label: 'Naval forces deployed', severity: 70 },
  '1903': { type: 'conflict', label: 'Military patrol', severity: 55 },
  '1904': { type: 'conflict', label: 'Military raid', severity: 70 },
  '191': { type: 'conflict', label: 'Naval blockade', severity: 60 },
  '1911': { type: 'conflict', label: 'Sea blockade imposed', severity: 65 },
  '1912': { type: 'conflict', label: 'Land corridor blocked', severity: 60 },
  '192': { type: 'conflict', label: 'Territory seized', severity: 75 },
  '1921': { type: 'conflict', label: 'Military occupation', severity: 80 },
  '193': { type: 'conflict', label: 'Gunfight / small arms clash', severity: 65 },
  '1931': { type: 'conflict', label: 'Firefight with small arms', severity: 65 },
  '1932': { type: 'conflict', label: 'Armed ambush', severity: 70 },
  '194': { type: 'airstrike', label: 'Artillery shelling', severity: 80 },
  '1941': { type: 'airstrike', label: 'Tank battle', severity: 80 },
  '1942': { type: 'airstrike', label: 'Artillery barrage', severity: 82 },
  '195': { type: 'airstrike', label: 'Air strike', severity: 85 },
  '1951': { type: 'airstrike', label: 'Drone strike', severity: 85 },
  '1952': { type: 'airstrike', label: 'Bomber air strike', severity: 88 },
  '1953': { type: 'airstrike', label: 'Missile strike', severity: 90 },
  '196': { type: 'conflict', label: 'Ceasefire violated', severity: 70 },

  // 20x — Unconventional mass violence
  '200': { type: 'conflict', label: 'Mass violence', severity: 90 },
  '201': { type: 'conflict', label: 'Mass forced displacement', severity: 85 },
  '202': { type: 'conflict', label: 'Ethnic cleansing', severity: 95 },
  '203': { type: 'airstrike', label: 'Nuclear / WMD attack', severity: 100 },
  '2031': { type: 'airstrike', label: 'Nuclear detonation', severity: 100 },
  '2032': { type: 'airstrike', label: 'Radiological weapon', severity: 98 },
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

// GDELT v2 export columns (tab-separated, 61 columns 0-60).
// V2 adds ADM2Code columns for each geo block vs V1.
const COL = {
  GLOBALEVENTID: 0,
  SQLDATE: 1,
  Actor1Code: 5,
  Actor1CountryCode: 7,
  Actor2Code: 15,
  Actor2CountryCode: 17,
  EventCode: 26,
  EventBaseCode: 27,
  EventRootCode: 28,
  GoldsteinScale: 30,
  NumMentions: 31,
  NumSources: 32,
  NumArticles: 33,
  ActionGeo_Type: 51,
  ActionGeo_FullName: 52,
  ActionGeo_CountryCode: 53,
  ActionGeo_Lat: 56,
  ActionGeo_Long: 57,
  DATEADDED: 59,
  SOURCEURL: 60,
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
    const seenIds = new Set<string>();

    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 61) continue;

      const globalEventId = cols[COL.GLOBALEVENTID] || '';
      if (seenIds.has(globalEventId)) continue;
      seenIds.add(globalEventId);

      const eventCode = cols[COL.EventCode] || '';
      const rootCode = cols[COL.EventRootCode] || '';

      const match = CONFLICT_CAMEO[eventCode] || CONFLICT_CAMEO[rootCode];
      if (!match) continue;

      const lat = parseFloat(cols[COL.ActionGeo_Lat]);
      const lng = parseFloat(cols[COL.ActionGeo_Long]);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

      const countryCode = (cols[COL.ActionGeo_CountryCode] || 'XX').substring(0, 2);
      const goldstein = parseFloat(cols[COL.GoldsteinScale] || '0');
      const numArticles = parseInt(cols[COL.NumArticles] || '1', 10);
      const locationName = cols[COL.ActionGeo_FullName] || '';
      const sourceUrl = (cols[COL.SOURCEURL] || '').toLowerCase();

      const domain = sourceUrl.replace(/^https?:\/\//, '').split('/')[0];
      if (JUNK_DOMAINS.some(d => domain.includes(d))) continue;
      if (JUNK_URL_PATTERNS.some(p => p.test(sourceUrl))) continue;

      if (match.severity >= 80 && numArticles < 3) continue;
      if (match.severity >= 70 && numArticles < 2) continue;

      const severity = Math.min(100, match.severity + Math.min(15, numArticles * 2));

      const actor1Name = cols[COL.Actor1Code] || '';
      const actor2Name = cols[COL.Actor2Code] || '';

      const tags = ['gdelt', 'conflict', 'geocoded', match.type];
      if (countryCode !== 'XX') tags.push(countryCode.toLowerCase());

      const location = locationName || COUNTRY_NAMES[countryCode] || countryCode;
      const title = `${match.label} in ${location}`;

      const actor1 = COUNTRY_NAMES[actor1Name] || actor1Name;
      const actor2 = COUNTRY_NAMES[actor2Name] || actor2Name;
      const hasActors = actor1Name && actor2Name && actor1Name !== actor2Name;

      const descParts: string[] = [];
      if (hasActors) {
        descParts.push(`${actor1} ${match.type === 'protest' ? 'protesting against' : 'engaged against'} ${actor2}`);
      }
      descParts.push(`${match.label} reported in ${location}`);
      if (goldstein <= -8) descParts.push('Situation is extremely hostile');
      else if (goldstein <= -5) descParts.push('Situation is highly conflictual');
      else if (goldstein <= -2) descParts.push('Tensions are elevated');
      if (numArticles >= 5) descParts.push(`Confirmed across ${numArticles} independent sources`);
      else if (numArticles >= 2) descParts.push(`Corroborated by ${numArticles} sources`);

      const dateAdded = cols[COL.DATEADDED] || '';
      const timestamp = dateAdded.length >= 14
        ? `${dateAdded.slice(0, 4)}-${dateAdded.slice(4, 6)}-${dateAdded.slice(6, 8)}T${dateAdded.slice(8, 10)}:${dateAdded.slice(10, 12)}:${dateAdded.slice(12, 14)}Z`
        : new Date().toISOString();

      events.push({
        source: 'gdelt',
        type: match.type,
        severity,
        confidence: 0.65,
        lat,
        lng,
        country_code: countryCode,
        timestamp,
        title,
        summary: descParts.join('. '),
        tags,
        raw_data: {
          event_id: globalEventId,
          cameo_code: eventCode,
          cameo_label: match.label,
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

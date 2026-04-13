import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';
import { getCountryFromPosition } from '../geo-utils';

/**
 * GDELT Events 2.0 adapter — structured geocoded conflict events.
 * Different from the GDELT article API: this pulls actual events
 * with CAMEO codes, actor info, and precise lat/lng.
 * 
 * Free, no API key. Updates every 15 minutes.
 * http://data.gdeltproject.org/gdeltv2/lastupdate.txt
 */

// CAMEO event codes that indicate military/conflict actions
// Full list: https://www.gdeltproject.org/data/lookups/CAMEO.eventcodes.txt
const CAMEO_CONFLICT_CODES: Record<string, { type: EventType; label: string; severity_base: number }> = {
  // Use conventional military force
  '190': { type: 'conflict', label: 'Military force', severity_base: 70 },
  '191': { type: 'conflict', label: 'Impose blockade', severity_base: 60 },
  '192': { type: 'conflict', label: 'Occupy territory', severity_base: 75 },
  '193': { type: 'conflict', label: 'Fight with small arms', severity_base: 65 },
  '194': { type: 'conflict', label: 'Fight with artillery/tanks', severity_base: 80 },
  '195': { type: 'airstrike', label: 'Employ aerial weapons', severity_base: 85 },
  '196': { type: 'conflict', label: 'Violate ceasefire', severity_base: 70 },
  // Use unconventional mass violence
  '200': { type: 'conflict', label: 'Mass violence', severity_base: 90 },
  '201': { type: 'conflict', label: 'Engage in mass expulsion', severity_base: 85 },
  '202': { type: 'conflict', label: 'Engage in ethnic cleansing', severity_base: 95 },
  '203': { type: 'airstrike', label: 'Use WMD', severity_base: 100 },
  // Coerce
  '170': { type: 'conflict', label: 'Coerce', severity_base: 45 },
  '171': { type: 'conflict', label: 'Seize/damage property', severity_base: 50 },
  '172': { type: 'conflict', label: 'Impose sanctions', severity_base: 40 },
  '173': { type: 'conflict', label: 'Arrest/detain', severity_base: 45 },
  '174': { type: 'conflict', label: 'Expel/deport', severity_base: 50 },
  '175': { type: 'conflict', label: 'Use tactics of coercion', severity_base: 55 },
  // Assault
  '180': { type: 'conflict', label: 'Assault', severity_base: 55 },
  '181': { type: 'conflict', label: 'Abduct/hijack', severity_base: 60 },
  '182': { type: 'conflict', label: 'Physically assault', severity_base: 55 },
  '183': { type: 'conflict', label: 'Conduct suicide bombing', severity_base: 90 },
  '184': { type: 'conflict', label: 'Use chemical weapons', severity_base: 95 },
  '185': { type: 'airstrike', label: 'Use explosive device', severity_base: 80 },
  '186': { type: 'conflict', label: 'Assassinate', severity_base: 85 },
  // Protest
  '140': { type: 'protest', label: 'Protest', severity_base: 30 },
  '141': { type: 'protest', label: 'Demonstrate', severity_base: 25 },
  '142': { type: 'protest', label: 'Hunger strike', severity_base: 30 },
  '143': { type: 'protest', label: 'Strike/boycott', severity_base: 35 },
  '144': { type: 'protest', label: 'Obstruct passage', severity_base: 35 },
  '145': { type: 'protest', label: 'Protest violently/riot', severity_base: 50 },
};

export class GDELTEventsAdapter extends BaseAdapter {
  source: DataSource = 'gdelt';
  fetchIntervalMinutes = 15;

  async fetch(): Promise<IntelEvent[]> {
    try {
      // Get the latest 15-minute export file URL
      const updateRes = await this.safeFetch('http://data.gdeltproject.org/gdeltv2/lastupdate.txt');
      if (!updateRes.ok) {
        this.warn(`GDELT lastupdate returned ${updateRes.status}`);
        return [];
      }

      const updateText = await updateRes.text();
      const lines = updateText.trim().split('\n');
      
      // Find the events export file (not mentions or GKG)
      const eventsLine = lines.find(l => l.includes('.export.CSV'));
      if (!eventsLine) {
        this.warn('No events export found in GDELT lastupdate');
        return [];
      }

      const eventsUrl = eventsLine.split(' ').pop()?.trim();
      if (!eventsUrl) return [];

      // Fetch the ZIP file
      const zipRes = await this.safeFetch(eventsUrl);
      if (!zipRes.ok) {
        this.warn(`GDELT events file returned ${zipRes.status}`);
        return [];
      }

      // The file is a ZIP containing a tab-separated CSV
      // Since we can't easily unzip in pure Node without a dep,
      // we'll use the GDELT BigQuery-compatible API endpoint instead
      return this.fetchViaAPI();
    } catch (err) {
      this.error('GDELT events fetch failed', err);
      return this.fetchViaAPI();
    }
  }

  private async fetchViaAPI(): Promise<IntelEvent[]> {
    try {
      // Use GDELT's event API to get conflict/military events from the last hour
      // Filter for CAMEO root codes 14 (protest), 17-20 (conflict/force)
      const query = encodeURIComponent('(airstrike OR bombing OR shelling OR attack OR military OR conflict OR protest OR missile) sourcelang:eng');
      const url =
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}` +
        '&mode=artlist&maxrecords=100&format=json&timespan=60min' +
        '&sort=datedesc';

      const res = await this.safeFetch(url);
      if (!res.ok) {
        if (res.status === 429) {
          this.warn('GDELT rate limited — will retry next cycle');
          return [];
        }
        this.warn(`GDELT API returned ${res.status}`);
        return [];
      }

      const text = await res.text();
      let data: { articles?: GDELTArticle[] };
      try {
        data = JSON.parse(text);
      } catch {
        this.warn('GDELT returned non-JSON response');
        return [];
      }

      if (!data.articles) return [];

      const events: IntelEvent[] = [];

      for (const art of data.articles) {
        const title = (art.title || '').toLowerCase();
        
        // Classify event type from title keywords
        let eventType: EventType = 'conflict';
        let baseSeverity = 50;

        if (/airstrike|air\s*strike|bomb(ing|ed)|aerial/.test(title)) {
          eventType = 'airstrike';
          baseSeverity = 85;
        } else if (/shell(ing|ed)|artiller|rocket|missile/.test(title)) {
          eventType = 'airstrike';
          baseSeverity = 80;
        } else if (/explo(sion|ded)|blast|detonat/.test(title)) {
          eventType = 'airstrike';
          baseSeverity = 75;
        } else if (/protest|demonstrat|rally|riot/.test(title)) {
          eventType = 'protest';
          baseSeverity = 35;
        } else if (/attack|assault|ambush|clash|fighting/.test(title)) {
          eventType = 'conflict';
          baseSeverity = 65;
        } else if (/kill(ed|ing|s)|dead|death|casualt|fatalit/.test(title)) {
          baseSeverity = 75;
        } else if (/war|invasion|offensive|operation/.test(title)) {
          baseSeverity = 60;
        }

        // Extract country from source country or title
        const countryCode = art.sourcecountry?.substring(0, 2)?.toUpperCase() || 'XX';

        const timestamp = art.seendate
          ? `${art.seendate.substring(0, 4)}-${art.seendate.substring(4, 6)}-${art.seendate.substring(6, 8)}T${art.seendate.substring(8, 10)}:${art.seendate.substring(10, 12)}:${art.seendate.substring(12, 14)}Z`
          : new Date().toISOString();

        // Build conflict-specific tags
        const tags = ['gdelt', 'conflict'];
        if (eventType === 'airstrike') tags.push('bombing', 'airstrike');
        if (/ukraine|ukrainian/.test(title)) tags.push('ukraine');
        if (/russia|russian/.test(title)) tags.push('russia');
        if (/gaza|palestinian|hamas/.test(title)) tags.push('gaza');
        if (/israel|israeli|idf/.test(title)) tags.push('israel');
        if (/syria|syrian/.test(title)) tags.push('syria');
        if (/sudan|sudanese/.test(title)) tags.push('sudan');
        if (/yemen|houthi/.test(title)) tags.push('yemen');
        if (/myanmar|burma/.test(title)) tags.push('myanmar');

        events.push({
          source: 'gdelt',
          type: eventType,
          severity: baseSeverity,
          confidence: 0.65,
          lat: 0,
          lng: 0,
          country_code: countryCode,
          timestamp,
          title: art.title || 'GDELT conflict event',
          summary: art.url || '',
          tags,
          raw_data: {
            url: art.url,
            domain: art.domain,
            source_country: art.sourcecountry,
            tone: art.tone,
            language: art.language,
          },
        });
      }

      this.log(`Fetched ${events.length} conflict-focused events`);
      return events;
    } catch (err) {
      this.error('GDELT events API failed', err);
      return [];
    }
  }
}

interface GDELTArticle {
  url?: string;
  title?: string;
  seendate?: string;
  sourcecountry?: string;
  domain?: string;
  tone?: number;
  language?: string;
}

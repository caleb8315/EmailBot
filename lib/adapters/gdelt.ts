import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';

/**
 * GDELT 2.0 adapter — geocoded global news events.
 * Free, no API key, updates every 15 minutes.
 * Uses the GDELT Events 2.0 API for structured event queries.
 */

const CAMEO_TO_EVENT_TYPE: Record<string, EventType> = {
  '18': 'airstrike',
  '19': 'conflict',
  '190': 'conflict',
  '193': 'conflict',
  '194': 'conflict',
  '195': 'airstrike',
  '14': 'protest',
  '140': 'protest',
  '141': 'protest',
  '145': 'protest',
  '172': 'sanctions_new',
  '173': 'sanctions_new',
};

function goldsteinToSeverity(goldstein: number): number {
  // Goldstein ranges from -10 (most conflictual) to +10 (most cooperative)
  // Map negative values to high severity, positive to low
  const clamped = Math.max(-10, Math.min(10, goldstein));
  return Math.round(((clamped * -1) + 10) / 20 * 100);
}

function cameoToEventType(code: string): EventType {
  if (CAMEO_TO_EVENT_TYPE[code]) return CAMEO_TO_EVENT_TYPE[code];
  const root = code.substring(0, 2);
  if (CAMEO_TO_EVENT_TYPE[root]) return CAMEO_TO_EVENT_TYPE[root];
  if (root >= '17') return 'conflict';
  if (root >= '14') return 'protest';
  return 'news_signal';
}

export class GDELTAdapter extends BaseAdapter {
  source: DataSource = 'gdelt';
  fetchIntervalMinutes = 15;

  async fetch(): Promise<IntelEvent[]> {
    try {
      const query = encodeURIComponent(
        '(conflict OR military OR protest OR sanctions OR missile OR airstrike) sourcelang:eng',
      );
      const url =
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}` +
        '&mode=artlist&maxrecords=75&format=json&timespan=60min';

      const res = await this.safeFetch(url);
      if (!res.ok) {
        this.warn(`GDELT API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as { articles?: GDELTArticle[] };
      if (!data.articles) return [];

      const events: IntelEvent[] = [];

      for (const art of data.articles) {
        const lat = art.sourcecountry ? 0 : 0;
        const lng = 0;

        events.push({
          source: 'gdelt',
          type: 'news_signal',
          severity: art.tone ? goldsteinToSeverity(art.tone) : 50,
          confidence: 0.65,
          lat,
          lng,
          country_code: art.sourcecountry?.substring(0, 2)?.toUpperCase() || 'XX',
          timestamp: art.seendate
            ? `${art.seendate.substring(0, 4)}-${art.seendate.substring(4, 6)}-${art.seendate.substring(6, 8)}T${art.seendate.substring(8, 10)}:${art.seendate.substring(10, 12)}:${art.seendate.substring(12, 14)}Z`
            : new Date().toISOString(),
          title: art.title || 'GDELT event',
          summary: art.url || '',
          tags: ['gdelt', 'news', art.domain || ''],
          raw_data: art as unknown as Record<string, unknown>,
        });
      }

      this.log(`Fetched ${events.length} articles`);
      return events;
    } catch (err) {
      this.error('GDELT fetch failed', err);
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

import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

/**
 * Wraps the existing RSS pipeline from src/fetch_sources.ts.
 * Normalises RawArticle output into IntelEvent format.
 */
export class RSSAdapter extends BaseAdapter {
  source: DataSource = 'rss';
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    try {
      const Parser = require('rss-parser');
      const sourcesConfig = require('../../config/sources.json');
      const parser = new Parser({ timeout: 15_000, headers: { 'User-Agent': 'JeffIntelligenceBot/2.0' } });
      const events: IntelEvent[] = [];

      const feeds = (sourcesConfig as { sources: { name: string; url: string; type: string; category: string; trust_score: number }[] }).sources
        .filter(s => s.type === 'rss');

      const results = await Promise.allSettled(feeds.map(f => parser.parseURL(f.url)));

      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res.status !== 'fulfilled') continue;
        const feed = feeds[i];

        for (const item of res.value.items ?? []) {
          if (!item.title || !item.link) continue;

          events.push({
            source: 'rss',
            type: 'news_signal',
            severity: Math.round((feed.trust_score / 10) * 50),
            confidence: feed.trust_score / 10,
            lat: 0,
            lng: 0,
            country_code: 'XX',
            timestamp: item.isoDate ?? new Date().toISOString(),
            title: item.title.trim(),
            summary: (item.contentSnippet ?? item.content ?? '').replace(/<[^>]*>/g, ' ').trim().slice(0, 500),
            tags: ['rss', feed.category],
            raw_data: { url: item.link, source_name: feed.name, category: feed.category },
          });
        }
      }

      this.log(`Fetched ${events.length} articles from ${feeds.length} feeds`);
      return events;
    } catch (err) {
      this.error('RSS fetch failed', err);
      return [];
    }
  }
}

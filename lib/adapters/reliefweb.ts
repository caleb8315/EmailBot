import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';

/**
 * ReliefWeb/conflict RSS adapter.
 * Pulls conflict and crisis reports from multiple free RSS feeds.
 * No API key needed, no registration required.
 */

const CONFLICT_FEEDS = [
  { url: 'https://reliefweb.int/updates/rss.xml?search=airstrike+OR+bombing+OR+shelling', name: 'ReliefWeb Airstrikes', type: 'airstrike' as EventType },
  { url: 'https://reliefweb.int/updates/rss.xml?search=conflict+OR+fighting+OR+battle', name: 'ReliefWeb Conflict', type: 'conflict' as EventType },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', type: 'news_signal' as EventType },
  { url: 'https://rss.app/feeds/v1.1/tgbGMcWV5EqZnl71.xml', name: 'OSINT Conflict', type: 'conflict' as EventType },
];

export class ConflictRSSAdapter extends BaseAdapter {
  source: DataSource = 'rss';
  fetchIntervalMinutes = 30;

  async fetch(): Promise<IntelEvent[]> {
    let Parser: any;
    try {
      Parser = require('rss-parser');
    } catch {
      this.error('rss-parser not available');
      return [];
    }

    const parser = new Parser({ timeout: 15_000, headers: { 'User-Agent': 'JeffIntelligenceBot/2.0' } });
    const events: IntelEvent[] = [];

    const results = await Promise.allSettled(
      CONFLICT_FEEDS.map(feed => parser.parseURL(feed.url).then((r: any) => ({ feed, result: r }))),
    );

    for (const res of results) {
      if (res.status !== 'fulfilled') continue;
      const { feed, result } = res.value;

      for (const item of result.items || []) {
        if (!item.title || !item.link) continue;

        const title = item.title.trim().toLowerCase();
        let eventType = feed.type;
        let severity = 50;

        // Classify severity from title
        if (/airstrike|air\s*strike|bomb(ing|ed)|aerial|drone\s*strike/.test(title)) {
          eventType = 'airstrike';
          severity = 85;
        } else if (/shell(ing|ed)|artiller|rocket|missile|mortar/.test(title)) {
          eventType = 'airstrike';
          severity = 80;
        } else if (/explo(sion|ded)|blast|detonat|car\s*bomb/.test(title)) {
          eventType = 'airstrike';
          severity = 75;
        } else if (/kill(ed|ing|s)\s*\d+|massacre|casualt|dead/.test(title)) {
          severity = 80;
        } else if (/attack|assault|ambush|clash|fighting|offensive/.test(title)) {
          eventType = 'conflict';
          severity = 65;
        } else if (/ceasefire|peace|negotiat|withdraw/.test(title)) {
          severity = 40;
        }

        // Tag by conflict zone
        const tags = ['conflict_rss', feed.name.toLowerCase().replace(/\s+/g, '_')];
        if (/ukrain/.test(title)) tags.push('ukraine');
        if (/russia/.test(title)) tags.push('russia');
        if (/gaza|palestin|hamas/.test(title)) tags.push('gaza');
        if (/israel/.test(title)) tags.push('israel');
        if (/syria/.test(title)) tags.push('syria');
        if (/sudan/.test(title)) tags.push('sudan');
        if (/yemen|houthi/.test(title)) tags.push('yemen');
        if (/myanmar|burma/.test(title)) tags.push('myanmar');
        if (/lebanon|hezbollah/.test(title)) tags.push('lebanon');
        if (/iraq/.test(title)) tags.push('iraq');
        if (/iran/.test(title)) tags.push('iran');
        if (/ethiopia|tigray/.test(title)) tags.push('ethiopia');
        if (/congo|drc/.test(title)) tags.push('drc');

        // Only include items that are actually conflict-related
        const isConflict = eventType !== 'news_signal' || severity >= 60 || tags.length > 2;
        if (!isConflict) continue;

        events.push({
          source: 'rss',
          type: eventType,
          severity,
          confidence: 0.7,
          lat: 0,
          lng: 0,
          country_code: 'XX',
          timestamp: item.isoDate || new Date().toISOString(),
          title: item.title.trim(),
          summary: (item.contentSnippet || item.content || '').replace(/<[^>]*>/g, ' ').trim().slice(0, 500),
          tags,
          raw_data: { url: item.link, feed: feed.name },
        });
      }
    }

    this.log(`Fetched ${events.length} conflict-specific articles`);
    return events;
  }
}

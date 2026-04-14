import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

const CISA_FEED = 'https://www.cisa.gov/cybersecurity-advisories/all.xml';

const CRITICAL_KEYWORDS = [
  'active exploitation', 'critical', 'zero-day', '0-day',
  'ransomware', 'nation-state', 'apt', 'emergency directive',
];

export class CISAAdapter extends BaseAdapter {
  source: DataSource = 'cisa';
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    try {
      const res = await this.safeFetch(CISA_FEED);
      if (!res.ok) {
        this.warn(`CISA feed returned ${res.status}`);
        return [];
      }

      const text = await res.text();
      const items = this.parseRssItems(text);
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;

      const events: IntelEvent[] = [];
      for (const item of items) {
        const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        if (pubDate < cutoff) continue;

        const combined = `${item.title ?? ''} ${item.description ?? ''}`.toLowerCase();
        const severity = this.scoreSeverity(combined);
        if (severity < 30) continue;

        events.push({
          source: 'cisa',
          type: 'cyber_advisory',
          severity,
          confidence: 0.95,
          lat: 38.9072,
          lng: -77.0369,
          country_code: 'US',
          timestamp: new Date(pubDate).toISOString(),
          title: `CISA: ${(item.title ?? 'Advisory').slice(0, 200)}`,
          summary: (item.description ?? '').slice(0, 500),
          tags: ['cisa', 'cyber', ...this.extractTags(combined)],
          raw_data: { link: item.link },
        });
      }

      this.log(`Found ${events.length} cyber advisories`);
      return events;
    } catch (err) {
      this.error('CISA fetch failed', err);
      return [];
    }
  }

  private scoreSeverity(text: string): number {
    let score = 40;
    for (const kw of CRITICAL_KEYWORDS) {
      if (text.includes(kw)) score += 15;
    }
    return Math.min(100, score);
  }

  private extractTags(text: string): string[] {
    const tags: string[] = [];
    if (text.includes('active exploitation')) tags.push('active_exploitation');
    if (text.includes('zero-day') || text.includes('0-day')) tags.push('zero_day');
    if (text.includes('ransomware')) tags.push('ransomware');
    if (text.includes('emergency directive')) tags.push('emergency_directive');
    return tags;
  }

  private parseRssItems(xml: string): { title?: string; description?: string; pubDate?: string; link?: string }[] {
    const items: { title?: string; description?: string; pubDate?: string; link?: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      items.push({
        title: this.extractTag(block, 'title'),
        description: this.extractTag(block, 'description'),
        pubDate: this.extractTag(block, 'pubDate'),
        link: this.extractTag(block, 'link'),
      });
    }
    return items;
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`);
    const m = re.exec(xml);
    return m?.[1]?.trim();
  }
}

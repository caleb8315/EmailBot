import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';
import { isNonKineticContext } from '../verification';

/**
 * OSINT & Defense Intelligence RSS adapter.
 * Pulls from the best free war/conflict/geopolitical analysis sources.
 * All free, no API keys, no registration.
 */

const INTEL_FEEDS = [
  // War analysis & conflict updates
  { url: 'https://www.crisisgroup.org/rss.xml', name: 'Crisis Group', category: 'conflict_analysis', trust: 0.9 },
  { url: 'https://www.bellingcat.com/feed/', name: 'Bellingcat', category: 'osint', trust: 0.85 },
  { url: 'https://warontherocks.com/feed/', name: 'War on the Rocks', category: 'defense_analysis', trust: 0.85 },

  // Military & defense news
  { url: 'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml', name: 'Military Times', category: 'military', trust: 0.8 },
  { url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', name: 'Defense News', category: 'military', trust: 0.8 },
  { url: 'https://www.armytimes.com/arc/outboundfeeds/rss/?outputType=xml', name: 'Army Times', category: 'military', trust: 0.75 },

  // International organizations
  { url: 'https://press.un.org/en/rss.xml', name: 'UN Press', category: 'diplomacy', trust: 0.9 },

  // Regional conflict sources
  { url: 'https://www.middleeasteye.net/rss', name: 'Middle East Eye', category: 'conflict', trust: 0.7 },
  { url: 'https://english.alarabiya.net/tools/rss', name: 'Al Arabiya', category: 'conflict', trust: 0.7 },
  { url: 'https://www.themoscowtimes.com/rss/news', name: 'Moscow Times', category: 'russia', trust: 0.65 },

  // Nuclear & WMD
  { url: 'https://www.armscontrol.org/rss.xml', name: 'Arms Control Association', category: 'nuclear', trust: 0.9 },
] as const;

// Keywords that indicate high-severity conflict events
const SEVERITY_KEYWORDS: [RegExp, number][] = [
  [/airstrike|air\s*strike|bomb(ing|ed)|drone\s*strike/, 85],
  [/shell(ing|ed)|artiller|rocket\s*attack|missile\s*(strike|attack|launch)/, 80],
  [/explo(sion|ded)|blast|detonat|car\s*bomb|suicide\s*bomb/, 75],
  [/kill(ed|ing|s)\s*\d+|massacre|casualt|fatalit|dead/, 75],
  [/invasion|invade|ground\s*offensive|advance/, 80],
  [/nuclear|warhead|enrichment|ICBM/, 90],
  [/ceasefire\s*(broke|violat|collaps)/, 70],
  [/coup|overthrow|martial\s*law/, 80],
  [/sanction(s|ed)|embargo/, 55],
  [/attack|assault|ambush|clash|fighting|offensive/, 65],
  [/deploy|mobiliz|reinforce|troop/, 60],
  [/escalat|tension|standoff|confront/, 55],
  [/ceasefire|peace|negotiat|withdraw|de-escalat/, 40],
  [/humanitarian|refugee|displace|evacuat/, 50],
];

// Region tags extracted from content
const REGION_TAGS: [RegExp, string][] = [
  [/ukrain|kyiv|kharkiv|donbas|zaporizhzhia/, 'ukraine'],
  [/russia|moscow|kremlin|putin/, 'russia'],
  [/gaza|palestin|hamas|west\s*bank/, 'gaza'],
  [/israel|tel\s*aviv|netanyahu|idf/, 'israel'],
  [/syria|damascus|assad|idlib/, 'syria'],
  [/sudan|khartoum|rsf|darfur/, 'sudan'],
  [/yemen|houthi|sanaa|aden/, 'yemen'],
  [/iran|tehran|irgc|khamenei/, 'iran'],
  [/taiwan|taipei|strait/, 'taiwan'],
  [/china|beijing|pla|xi\s*jinping/, 'china'],
  [/north\s*korea|pyongyang|kim\s*jong/, 'north_korea'],
  [/myanmar|burma|junta|rohingya/, 'myanmar'],
  [/lebanon|hezbollah|beirut/, 'lebanon'],
  [/iraq|baghdad|kurdistan/, 'iraq'],
  [/libya|tripoli|haftar/, 'libya'],
  [/ethiopia|tigray|amhara/, 'ethiopia'],
  [/congo|kinshasa|drc/, 'drc'],
  [/somalia|mogadishu|al.shabaab/, 'somalia'],
  [/nato|alliance|article\s*5/, 'nato'],
  [/nuclear|atomic|warhead|icbm/, 'nuclear'],
];

export class OSINTFeedsAdapter extends BaseAdapter {
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

    const parser = new Parser({ timeout: 12_000, headers: { 'User-Agent': 'JeffIntelBot/2.0' } });
    const events: IntelEvent[] = [];

    const results = await Promise.allSettled(
      INTEL_FEEDS.map(feed =>
        parser.parseURL(feed.url)
          .then((r: any) => ({ feed, result: r }))
          .catch(() => null),
      ),
    );

    for (const res of results) {
      if (res.status !== 'fulfilled' || !res.value) continue;
      const { feed, result } = res.value;

      for (const item of (result.items || []).slice(0, 15)) {
        if (!item.title || !item.link) continue;

        const titleLower = item.title.toLowerCase();
        const contentLower = ((item.contentSnippet || item.content || '') + ' ' + item.title).toLowerCase();

        // Score severity from keywords
        let severity = 40;
        let eventType: EventType = 'news_signal';

        for (const [pattern, sev] of SEVERITY_KEYWORDS) {
          if (pattern.test(contentLower)) {
            if (sev > severity) severity = sev;
            if (sev >= 70) eventType = 'conflict';
            if (/airstrike|bomb|shell|missile|explo|artiller/.test(contentLower)) eventType = 'airstrike';
          }
        }

        // Context guard: suppress conflict escalation for policy/rights/legal articles
        if (isNonKineticContext(contentLower)) {
          severity = Math.min(severity, 30);
          eventType = 'news_signal';
        }

        // Only include articles that are conflict/geopolitical relevant
        const isRelevant = severity >= 50 || feed.category === 'conflict_analysis' || feed.category === 'osint';
        if (!isRelevant) continue;

        // Extract region tags
        const tags = ['osint', feed.category, feed.name.toLowerCase().replace(/\s+/g, '_')];
        for (const [pattern, tag] of REGION_TAGS) {
          if (pattern.test(contentLower)) tags.push(tag);
        }

        events.push({
          source: 'rss',
          type: eventType,
          severity,
          confidence: feed.trust,
          lat: 0,
          lng: 0,
          country_code: 'XX',
          timestamp: item.isoDate || new Date().toISOString(),
          title: item.title.trim(),
          summary: (item.contentSnippet || '').replace(/<[^>]*>/g, ' ').trim().slice(0, 500),
          tags,
          raw_data: { url: item.link, feed: feed.name, category: feed.category },
        });
      }
    }

    this.log(`Fetched ${events.length} intel articles from ${INTEL_FEEDS.length} OSINT feeds`);
    return events;
  }
}

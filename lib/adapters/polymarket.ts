import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';
import { createClient } from '@supabase/supabase-js';

/**
 * Polymarket / prediction market adapter.
 * Tracks probability movements on geopolitical markets.
 * Free public API — no key needed.
 */

const GEOPOLITICAL_KEYWORDS = [
  'war', 'invasion', 'military', 'nuclear', 'sanctions', 'ceasefire',
  'election', 'coup', 'impeach', 'nato', 'china', 'russia', 'iran',
  'taiwan', 'ukraine', 'israel', 'korea', 'conflict', 'missile',
];

export class PolymarketAdapter extends BaseAdapter {
  source: DataSource = 'polymarket';
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    try {
      // Polymarket public CLOB API
      const res = await this.safeFetch(
        'https://clob.polymarket.com/markets?limit=50&active=true&order=volume&ascending=false',
      );

      if (!res.ok) {
        this.warn(`Polymarket returned ${res.status}`);
        return [];
      }

      const body = await res.json() as { data?: PolyMarket[] } | PolyMarket[];
      const markets = Array.isArray(body) ? body : (body.data || []);
      const events: IntelEvent[] = [];
      const sb = this.getSupabase();

      for (const market of markets) {
        const question = (market.question || '').toLowerCase();
        const isRelevant = GEOPOLITICAL_KEYWORDS.some(kw => question.includes(kw));
        if (!isRelevant) continue;

        const currentProb = market.tokens?.[0]?.price ?? market.outcomePrices?.[0] ?? null;
        if (currentProb === null) continue;

        // Check for significant movement
        if (sb) {
          const { data: prev } = await sb
            .from('prediction_markets')
            .select('current_probability')
            .eq('platform', 'polymarket')
            .eq('external_id', market.condition_id || market.id || '')
            .single();

          const prevProb = prev?.current_probability ?? currentProb;
          const delta = currentProb - prevProb;

          // Store/update market data
          await sb.from('prediction_markets').upsert({
            platform: 'polymarket',
            external_id: market.condition_id || market.id || '',
            question: market.question || '',
            current_probability: currentProb,
            probability_24h_ago: prevProb,
            delta_24h: delta,
            volume_usd: market.volume || 0,
            tags: ['polymarket', 'geopolitical'],
            last_updated: new Date().toISOString(),
          }, { onConflict: 'platform,external_id' });

          // Alert on significant probability spike (>15% in one cycle)
          if (Math.abs(delta) > 0.15) {
            events.push({
              source: 'polymarket',
              type: 'prediction_market_spike',
              severity: Math.min(100, Math.round(Math.abs(delta) * 200)),
              confidence: 0.7,
              lat: 0,
              lng: 0,
              country_code: 'XX',
              timestamp: new Date().toISOString(),
              title: `Market spike: ${market.question?.slice(0, 120)}`,
              summary: `${(currentProb * 100).toFixed(0)}% (${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%) | Vol: $${formatVolume(market.volume)}`,
              tags: ['polymarket', 'prediction_market', delta > 0 ? 'probability_up' : 'probability_down'],
              raw_data: {
                question: market.question,
                current: currentProb,
                previous: prevProb,
                delta,
                volume: market.volume,
              },
            });
          }
        }
      }

      this.log(`Tracked ${markets.length} markets, ${events.length} spikes detected`);
      return events;
    } catch (err) {
      this.error('Polymarket fetch failed', err);
      return [];
    }
  }

  private getSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return createClient(url, key);
  }
}

function formatVolume(v?: number): string {
  if (!v) return '?';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

interface PolyMarket {
  id?: string;
  condition_id?: string;
  question?: string;
  volume?: number;
  tokens?: { price: number }[];
  outcomePrices?: number[];
}

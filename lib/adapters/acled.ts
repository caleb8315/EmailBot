import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';

/**
 * ACLED adapter — Armed Conflict Location & Event Data.
 * Free API key from acleddata.com. High-reliability conflict events.
 */

const EVENT_TYPE_MAP: Record<string, EventType> = {
  'Battles': 'conflict',
  'Violence against civilians': 'conflict',
  'Explosions/Remote violence': 'airstrike',
  'Riots': 'protest',
  'Protests': 'protest',
  'Strategic developments': 'news_signal',
};

function fatalityToSeverity(fatalities: number): number {
  if (fatalities === 0) return 20;
  if (fatalities <= 5) return 45;
  if (fatalities <= 20) return 65;
  if (fatalities <= 100) return 80;
  return 95;
}

export class ACLEDAdapter extends BaseAdapter {
  source: DataSource = 'acled';
  fetchIntervalMinutes = 60;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  private async getAccessToken(): Promise<string | null> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const email = process.env.ACLED_EMAIL;
    const password = process.env.ACLED_PASSWORD;

    // Support both OAuth (email+password) and legacy (API key) auth
    if (email && password) {
      try {
        const params = new URLSearchParams({
          username: email,
          password,
          grant_type: 'password',
          client_id: 'acled',
        });
        const res = await fetch('https://acleddata.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        if (!res.ok) {
          this.warn(`ACLED OAuth failed: ${res.status}`);
          return null;
        }

        const data = await res.json() as { access_token?: string; expires_in?: number };
        if (data.access_token) {
          this.cachedToken = data.access_token;
          this.tokenExpiresAt = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
          return this.cachedToken;
        }
      } catch (err) {
        this.error('ACLED OAuth token fetch failed', err);
      }
    }

    // Fallback: legacy API key
    return process.env.ACLED_API_KEY || null;
  }

  async fetch(): Promise<IntelEvent[]> {
    const token = await this.getAccessToken();
    if (!token) {
      this.warn('No ACLED credentials set (need ACLED_EMAIL+ACLED_PASSWORD or ACLED_API_KEY) — skipping');
      return [];
    }

    try {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];

      // ACLED API endpoints to try (they change periodically)
      const endpoints = [
        `https://api.acleddata.com/acled/read?limit=200&event_date_where=%3E&event_date=${yesterday}`,
        `https://acleddata.com/api/explorer/v1/data?limit=200&event_date_where=%3E&event_date=${yesterday}`,
      ];

      let res: Response | null = null;
      for (const endpoint of endpoints) {
        try {
          const r = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(20_000),
          });
          if (r.ok || r.status === 403) {
            res = r;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!res || !res.ok) {
        this.warn('ACLED API endpoints unreachable — their API may be in transition. OAuth works but data endpoint is down.');
        return [];
      }
      if (!res.ok) {
        this.warn(`ACLED API returned ${res.status}`);
        return [];
      }

      const body = await res.json() as { data?: ACLEDEvent[] };
      if (!body.data) return [];

      const events: IntelEvent[] = body.data
        .filter(e => e.latitude && e.longitude)
        .map(e => ({
          source: 'acled' as DataSource,
          type: EVENT_TYPE_MAP[e.event_type] || 'conflict',
          severity: fatalityToSeverity(parseInt(e.fatalities || '0', 10)),
          confidence: 0.85,
          lat: parseFloat(e.latitude),
          lng: parseFloat(e.longitude),
          country_code: e.iso?.toString().substring(0, 2) || 'XX',
          timestamp: new Date(e.event_date).toISOString(),
          title: `${e.event_type}: ${e.location || e.country}`,
          summary: (e.notes || '').slice(0, 500),
          tags: ['acled', 'conflict', (e.event_type || '').toLowerCase().replace(/\s+/g, '_')],
          raw_data: e as unknown as Record<string, unknown>,
        }));

      this.log(`Fetched ${events.length} conflict events`);
      return events;
    } catch (err) {
      this.error('ACLED fetch failed', err);
      return [];
    }
  }
}

interface ACLEDEvent {
  event_date: string;
  event_type: string;
  sub_event_type?: string;
  actor1?: string;
  actor2?: string;
  country?: string;
  iso?: number;
  location?: string;
  latitude: string;
  longitude: string;
  fatalities?: string;
  notes?: string;
}

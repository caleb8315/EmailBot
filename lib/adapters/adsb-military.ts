import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent, EventType } from '../types';
import { getCountryFromPosition } from '../geo-utils';

const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const TOKEN_REFRESH_MARGIN_MS = 60_000; // refresh 60s before expiry

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getOpenSkyToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    cachedToken = null;
    return null;
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = data.access_token;
  const expiresIn = (data.expires_in ?? 1800) * 1000;
  tokenExpiresAt = Date.now() + expiresIn - TOKEN_REFRESH_MARGIN_MS;
  return cachedToken;
}

interface CallsignPattern {
  pattern: RegExp;
  type: 'isr' | 'doomsday' | 'tanker' | 'special_ops' | 'nato' | 'bomber' | 'transport';
  significance: number;
  description: string;
}

const MILITARY_CALLSIGN_PATTERNS: CallsignPattern[] = [
  // US ISR (Intelligence, Surveillance, Reconnaissance)
  { pattern: /^FORTE\d+/, type: 'isr', significance: 95, description: 'USAF RQ-4 Global Hawk SIGINT' },
  { pattern: /^JAKE\d+/, type: 'isr', significance: 90, description: 'USAF ISR asset' },
  { pattern: /^REAPER\d+/, type: 'isr', significance: 85, description: 'USAF ISR/SIGINT' },
  { pattern: /^TOPCAT\d+/, type: 'isr', significance: 85, description: 'US Navy P-8 Poseidon submarine hunter' },
  { pattern: /^HOMER\d+/, type: 'isr', significance: 80, description: 'USAF RC-135 Rivet Joint SIGINT' },

  // Doomsday planes — CRITICAL signal
  { pattern: /^IRON\d+/, type: 'doomsday', significance: 100, description: 'E-6B Mercury TACAMO — nuclear command relay AIRBORNE' },
  { pattern: /^USNDO\d+/, type: 'doomsday', significance: 100, description: 'E-6B Mercury — DEFCON watch' },
  { pattern: /^NIGHT\d+/, type: 'doomsday', significance: 98, description: 'E-4B Nightwatch — airborne command post' },

  // Special operations
  { pattern: /^MAGMA\d+/, type: 'special_ops', significance: 90, description: 'USAF Special Operations' },
  { pattern: /^KNIFE\d+/, type: 'special_ops', significance: 85, description: 'USSOCOM asset' },

  // Tankers — precursor to strike packages
  { pattern: /^REACH\d+/, type: 'tanker', significance: 60, description: 'USAF KC-135/KC-46 tanker' },
  { pattern: /^RCH\d+/, type: 'tanker', significance: 60, description: 'USAF airlift/tanker' },
  { pattern: /^PACK\d+/, type: 'tanker', significance: 65, description: 'USAF tanker formation' },

  // Bombers
  { pattern: /^DOOM\d+/, type: 'bomber', significance: 90, description: 'USAF B-52 strategic bomber' },
  { pattern: /^DEATH\d+/, type: 'bomber', significance: 92, description: 'USAF B-2 Spirit stealth bomber' },

  // NATO
  { pattern: /^NATO\d+/, type: 'nato', significance: 75, description: 'NATO command aircraft' },
  { pattern: /^AWACS\d+/, type: 'isr', significance: 85, description: 'NATO E-3 Sentry airborne radar' },

  // Transport (lower significance but trackable)
  { pattern: /^SAM\d+/, type: 'transport', significance: 50, description: 'Special Air Mission (VIP transport)' },
];

function isMilitaryICAOBlock(icao: string): boolean {
  const hex = icao.toLowerCase();
  // US military AE0000–AFFFFF
  if (hex.startsWith('ae') || hex.startsWith('af')) return true;
  // UK military 43xxxx
  if (hex.startsWith('43')) return true;
  // France 38xxxx
  if (hex.startsWith('38')) return true;
  return false;
}

function typeFromMatch(match: CallsignPattern | undefined): EventType {
  if (!match) return 'military_flight';
  switch (match.type) {
    case 'doomsday': return 'doomsday_plane';
    case 'isr': return 'military_flight_isr';
    case 'tanker': return 'tanker_surge';
    default: return 'military_flight';
  }
}

export class ADSBMilitaryAdapter extends BaseAdapter {
  source: DataSource = 'adsb';
  fetchIntervalMinutes = 5;

  async fetch(): Promise<IntelEvent[]> {
    const token = await getOpenSkyToken();
    if (!token) {
      this.warn('OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET not set or token fetch failed — skipping');
      return [];
    }

    try {
      const res = await this.safeFetch(
        'https://opensky-network.org/api/states/all',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        this.warn(`OpenSky returned ${res.status}`);
        return [];
      }

      const data = await res.json() as { states?: (string | number | boolean | null)[][] };
      if (!data.states) return [];

      const events: IntelEvent[] = [];

      for (const state of data.states) {
        const [icao24, callsign, , , , lng, lat, altitude, , velocity, heading] = state as [
          string, string | null, string, number, number,
          number | null, number | null, number | null, boolean,
          number | null, number | null,
        ];

        if (!lat || !lng || !callsign) continue;
        const cs = (callsign as string).trim();

        const match = MILITARY_CALLSIGN_PATTERNS.find(p => p.pattern.test(cs));
        const isMilICAO = isMilitaryICAOBlock(icao24 as string);

        if (!match && !isMilICAO) continue;

        events.push({
          source: 'adsb',
          type: typeFromMatch(match),
          severity: match?.significance || 50,
          confidence: 0.9,
          lat: lat as number,
          lng: lng as number,
          country_code: getCountryFromPosition(lat as number, lng as number),
          timestamp: new Date().toISOString(),
          title: `${cs} — ${match?.description || 'Military aircraft'}`,
          summary: `Alt: ${altitude ?? '?'}m | Spd: ${velocity ?? '?'}m/s | Hdg: ${heading ?? '?'}°`,
          tags: ['adsb', 'military', match?.type || 'unknown'],
          raw_data: {
            icao24,
            callsign: cs,
            altitude,
            velocity,
            heading,
            military_type: match?.type,
          },
        });
      }

      this.log(`Found ${events.length} military aircraft`);
      return events;
    } catch (err) {
      this.error('ADS-B fetch failed', err);
      return [];
    }
  }
}

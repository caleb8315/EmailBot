import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

/**
 * NOTAM (Notice to Airmen) adapter.
 * Airspace closures immediately before operations are one of the most
 * reliable pre-strike indicators — public, required by law, rarely faked.
 */
export class NOTAMAdapter extends BaseAdapter {
  source: DataSource = 'notam';
  fetchIntervalMinutes = 30;

  async fetch(): Promise<IntelEvent[]> {
    const clientId = process.env.FAA_CLIENT_ID;
    const clientSecret = process.env.FAA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      // NOTAMs require FAA API registration — skip silently
      return [];
    }

    try {
      const res = await this.safeFetch(
        'https://external-api.faa.gov/notamapi/v1/notams?' +
        'responseFormat=geoJson&notamType=N&classification=INTL',
        {
          headers: {
            'client_id': clientId,
            'client_secret': clientSecret,
          },
        },
      );

      if (!res.ok) {
        this.warn(`FAA API returned ${res.status} — falling back`);
        return this.fetchFallback();
      }

      const data = await res.json() as { features?: NOTAMFeature[] };
      if (!data.features) return [];

      const events = data.features
        .filter(f => this.isSignificant(f))
        .map(f => this.toEvent(f));

      this.log(`Found ${events.length} significant NOTAMs`);
      return events;
    } catch (err) {
      this.error('NOTAM fetch failed', err);
      return this.fetchFallback();
    }
  }

  private async fetchFallback(): Promise<IntelEvent[]> {
    // The FAA API requires registration; if unavailable we return empty
    // A production system would use EUROCONTROL or ICAO feeds
    return [];
  }

  private isSignificant(notam: NOTAMFeature): boolean {
    const msg = (notam.properties?.coreNOTAMData?.notam?.text || '').toUpperCase();
    return (
      msg.includes('TEMPORARY FLIGHT RESTRICTION') ||
      msg.includes('RESTRICTED') ||
      msg.includes('PROHIBITED') ||
      msg.includes('MILITARY OPERATION') ||
      msg.includes('MISSILE') ||
      msg.includes('LIVE FIRE') ||
      msg.includes('HAZARDOUS') ||
      msg.includes('NATIONAL DEFENSE')
    );
  }

  private scoreSeverity(notam: NOTAMFeature): number {
    const msg = (notam.properties?.coreNOTAMData?.notam?.text || '').toUpperCase();
    let score = 40;
    if (msg.includes('PROHIBITED')) score += 30;
    if (msg.includes('MILITARY OPERATION')) score += 25;
    if (msg.includes('MISSILE')) score += 35;
    if (msg.includes('LIVE FIRE')) score += 20;
    if (msg.includes('NATIONAL DEFENSE')) score += 30;
    return Math.min(100, score);
  }

  private toEvent(f: NOTAMFeature): IntelEvent {
    const notamData = f.properties?.coreNOTAMData?.notam || {};
    const coords = f.geometry?.coordinates || [0, 0];
    const [lng, lat] = Array.isArray(coords[0]) ? coords[0] : coords;

    return {
      source: 'notam',
      type: 'notam_closure',
      severity: this.scoreSeverity(f),
      confidence: 0.99,
      lat: lat as number || 0,
      lng: lng as number || 0,
      country_code: (notamData.location || '').substring(0, 2).toUpperCase() || 'XX',
      timestamp: notamData.issued ? new Date(notamData.issued).toISOString() : new Date().toISOString(),
      expires_at: notamData.endDate ? new Date(notamData.endDate).toISOString() : undefined,
      title: `NOTAM: ${notamData.classification || 'RESTRICTED'} — ${notamData.location || 'Unknown'}`,
      summary: (notamData.text || '').slice(0, 500),
      tags: ['notam', 'airspace', notamData.classification?.toLowerCase() || 'unknown'],
      raw_data: notamData as Record<string, unknown>,
    };
  }
}

interface NOTAMFeature {
  geometry?: { coordinates: number[] | number[][] };
  properties?: {
    coreNOTAMData?: {
      notam?: {
        text?: string;
        classification?: string;
        location?: string;
        issued?: string;
        endDate?: string;
      };
    };
  };
}

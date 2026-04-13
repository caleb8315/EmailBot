import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';
import { distanceKm, getCountryFromPosition, STRATEGIC_CHOKEPOINTS } from '../geo-utils';
import { createClient } from '@supabase/supabase-js';

const HOSPITAL_SHIPS = [
  { name: 'USNS Mercy', mmsi: '338234631', flag: 'US' },
  { name: 'USNS Comfort', mmsi: '338234632', flag: 'US' },
  { name: 'RFA Argus', mmsi: '232003676', flag: 'UK' },
  { name: 'Chinese Peace Ark', mmsi: '412000001', flag: 'CN' },
];

interface StoredPosition {
  mmsi: string;
  vessel_name?: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  timestamp: string;
}

/**
 * AIS Dark Ship Detector.
 * Compares current AIS positions against last-known positions stored in DB.
 * Detects vessels that stopped transmitting (went "dark") —
 * especially near strategic chokepoints.
 */
export class AISDarkShipAdapter extends BaseAdapter {
  source: DataSource = 'ais';
  fetchIntervalMinutes = 15;

  async fetch(): Promise<IntelEvent[]> {
    // AIS data sources that are free:
    // - AISHub community feed (requires registration)
    // We fall back to checking our stored positions for gaps
    const events: IntelEvent[] = [];

    try {
      const hospitalEvents = await this.checkHospitalShips();
      events.push(...hospitalEvents);
    } catch (err) {
      this.error('Hospital ship check failed', err);
    }

    try {
      const darkEvents = await this.detectDarkShips();
      events.push(...darkEvents);
    } catch (err) {
      this.error('Dark ship detection failed', err);
    }

    this.log(`Generated ${events.length} AIS events`);
    return events;
  }

  private async checkHospitalShips(): Promise<IntelEvent[]> {
    const events: IntelEvent[] = [];

    // Query our entity table for hospital ship last-known positions
    const sb = this.getSupabase();
    if (!sb) return [];

    for (const ship of HOSPITAL_SHIPS) {
      const { data } = await sb
        .from('entities')
        .select('last_known_location, last_seen, metadata')
        .eq('name', ship.name)
        .single();

      if (!data?.last_known_location) continue;

      // If ship has moved far from home port equivalent, flag it
      const meta = data.metadata as Record<string, unknown> || {};
      const homeLat = (meta.home_lat as number) || 0;
      const homeLng = (meta.home_lng as number) || 0;

      if (homeLat && homeLng) {
        // Parse PostGIS point — format: POINT(lng lat) or just coords from metadata
        const loc = data.last_known_location;
        const currentLat = (meta.current_lat as number) || 0;
        const currentLng = (meta.current_lng as number) || 0;

        if (currentLat && currentLng) {
          const dist = distanceKm(currentLat, currentLng, homeLat, homeLng);
          if (dist > 500) {
            events.push({
              source: 'ais',
              type: 'hospital_ship_movement',
              severity: 85,
              confidence: 0.95,
              lat: currentLat,
              lng: currentLng,
              country_code: getCountryFromPosition(currentLat, currentLng),
              timestamp: new Date().toISOString(),
              title: `${ship.name} deployed — ${dist.toFixed(0)}km from home port`,
              summary: `Hospital ship deployments historically precede operations by 2-6 weeks`,
              tags: ['ais', 'hospital_ship', 'pre_conflict_indicator', 'critical'],
              raw_data: { ship, distance_from_home: dist },
            });
          }
        }
      }
    }

    return events;
  }

  private async detectDarkShips(): Promise<IntelEvent[]> {
    const sb = this.getSupabase();
    if (!sb) return [];

    const events: IntelEvent[] = [];

    // Find entities (vessels) that haven't been seen in 6+ hours
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: staleVessels } = await sb
      .from('entities')
      .select('*')
      .eq('entity_type', 'vessel')
      .lt('last_seen', cutoff)
      .not('last_known_location', 'is', null);

    if (!staleVessels) return [];

    for (const vessel of staleVessels) {
      const meta = (vessel.metadata || {}) as Record<string, unknown>;
      const lat = (meta.last_lat as number) || 0;
      const lng = (meta.last_lng as number) || 0;
      const heading = vessel.last_known_heading || 0;
      const speed = vessel.last_known_speed || 0;

      if (!lat || !lng) continue;

      const hoursSilent = (Date.now() - new Date(vessel.last_seen).getTime()) / (1000 * 60 * 60);

      const nearChokepoint = STRATEGIC_CHOKEPOINTS.find(cp =>
        distanceKm(lat, lng, cp.lat, cp.lng) < cp.radius_km,
      );

      const severity = nearChokepoint
        ? 80 + Math.min(20, hoursSilent)
        : 40 + Math.min(30, hoursSilent);

      events.push({
        source: 'ais',
        type: 'vessel_dark',
        severity: Math.round(severity),
        confidence: 0.85,
        lat,
        lng,
        country_code: getCountryFromPosition(lat, lng),
        timestamp: new Date().toISOString(),
        title: `${vessel.name || 'Unknown vessel'} went dark — ${hoursSilent.toFixed(0)}hrs silent`,
        summary: nearChokepoint
          ? `Near ${nearChokepoint.name}. Last heading: ${heading}° at ${speed}kts`
          : `Open water. Last heading: ${heading}° at ${speed}kts`,
        tags: ['ais', 'dark_ship', nearChokepoint ? 'chokepoint' : 'open_water'],
        raw_data: {
          vessel_name: vessel.name,
          hours_silent: hoursSilent,
          near_chokepoint: nearChokepoint?.name,
          heading,
          speed,
        },
      });
    }

    return events;
  }

  private getSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return createClient(url, key);
  }
}

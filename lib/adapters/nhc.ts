import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

/**
 * NOAA NHC (National Hurricane Center) active storms adapter.
 * Tracks tropical cyclones, hurricanes, typhoons globally via GeoJSON.
 * Free, no API key required.
 */

function categoryToSeverity(maxWind: number): number {
  if (maxWind >= 137) return 95; // Cat 5
  if (maxWind >= 113) return 88; // Cat 4
  if (maxWind >= 96) return 78;  // Cat 3
  if (maxWind >= 83) return 68;  // Cat 2
  if (maxWind >= 64) return 58;  // Cat 1
  if (maxWind >= 34) return 40;  // Tropical storm
  return 25;                      // Depression
}

function windCategory(maxWind: number): string {
  if (maxWind >= 137) return 'Category 5 Hurricane';
  if (maxWind >= 113) return 'Category 4 Hurricane';
  if (maxWind >= 96) return 'Major Hurricane (Cat 3)';
  if (maxWind >= 83) return 'Category 2 Hurricane';
  if (maxWind >= 64) return 'Category 1 Hurricane';
  if (maxWind >= 34) return 'Tropical Storm';
  return 'Tropical Depression';
}

export class NHCAdapter extends BaseAdapter {
  source: DataSource = 'nhc';
  fetchIntervalMinutes = 60;

  async fetch(): Promise<IntelEvent[]> {
    if (!process.env.ENABLE_NHC) return [];

    try {
      const url = 'https://www.nhc.noaa.gov/CurrentSummaries.json';
      const res = await this.safeFetch(url);
      if (!res.ok) {
        const altUrl = 'https://api.weather.gov/alerts/active?event=Hurricane,Tropical%20Storm&limit=20';
        return this.fetchFromWeatherAPI(altUrl);
      }

      const data = await res.json() as NHCSummary;
      const events: IntelEvent[] = [];

      for (const system of data.activeStorms || []) {
        const wind = system.maxWind ?? 0;
        const lat = system.lat ?? 0;
        const lng = system.lon ?? 0;
        if (!lat && !lng) continue;

        events.push({
          source: 'nhc' as DataSource,
          type: 'news_signal' as const,
          severity: categoryToSeverity(wind),
          confidence: 0.95,
          lat,
          lng,
          country_code: 'XX',
          timestamp: new Date(system.lastUpdate || Date.now()).toISOString(),
          title: `${windCategory(wind)}: ${system.name || 'Unnamed'}`,
          summary: `${windCategory(wind)} ${system.name || ''} — max sustained winds ${wind} kt, moving ${system.movementDir || 'unknown'} at ${system.movementSpeed || '?'} kt`,
          tags: ['nhc', 'tropical_cyclone', 'natural_hazard', wind >= 64 ? 'hurricane' : 'tropical_storm'],
          raw_data: {
            source_url: system.url || 'https://www.nhc.noaa.gov/',
            max_wind_kt: wind,
            movement_dir: system.movementDir,
            movement_speed: system.movementSpeed,
            pressure: system.pressure,
            classification: system.classification,
          },
        });
      }

      this.log(`Fetched ${events.length} active tropical systems from NHC`);
      return events;
    } catch (err) {
      this.error('NHC fetch failed', err);
      return [];
    }
  }

  private async fetchFromWeatherAPI(url: string): Promise<IntelEvent[]> {
    try {
      const res = await this.safeFetch(url, {
        headers: { 'User-Agent': 'jeff-intel/1.0 (https://github.com/jeff-intel)', Accept: 'application/geo+json' },
      });
      if (!res.ok) return [];
      const data = await res.json() as { features: WeatherAlert[] };

      return (data.features || []).slice(0, 10).map(f => ({
        source: 'nhc' as DataSource,
        type: 'news_signal' as const,
        severity: 70,
        confidence: 0.9,
        lat: 0,
        lng: 0,
        country_code: 'US',
        timestamp: new Date(f.properties.effective).toISOString(),
        title: `${f.properties.event}: ${f.properties.headline || 'Alert'}`,
        summary: (f.properties.description || '').slice(0, 500),
        tags: ['nhc', 'tropical_cyclone', 'weather_alert'],
        raw_data: {
          source_url: f.properties.web || f.id,
          event: f.properties.event,
          severity: f.properties.severity,
          certainty: f.properties.certainty,
        },
      }));
    } catch {
      return [];
    }
  }
}

interface NHCSummary {
  activeStorms?: {
    name?: string;
    lat?: number;
    lon?: number;
    maxWind?: number;
    movementDir?: string;
    movementSpeed?: number;
    pressure?: number;
    classification?: string;
    lastUpdate?: string;
    url?: string;
  }[];
}

interface WeatherAlert {
  id: string;
  properties: {
    event: string;
    headline: string;
    description: string;
    effective: string;
    severity: string;
    certainty: string;
    web?: string;
  };
}

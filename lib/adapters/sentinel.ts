import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';
import { getCountryFromPosition } from '../geo-utils';

/**
 * Sentinel Hub satellite change detection adapter.
 * Uses the Processing API to compare current imagery against baselines
 * at strategic military/geopolitical locations.
 * 
 * Free tier: 30,000 processing units/month.
 * Checking 25 locations every 4 hours = ~4,500 requests/month.
 */

const WATCH_LOCATIONS = [
  // Russia/Ukraine theater
  { name: 'Crimea Naval Base (Sevastopol)', lat: 44.62, lng: 33.52, country: 'UA', priority: 'high' },
  { name: 'Kaliningrad Military Base', lat: 54.71, lng: 20.51, country: 'RU', priority: 'high' },
  { name: 'Rostov-on-Don (Southern Military District HQ)', lat: 47.24, lng: 39.72, country: 'RU', priority: 'high' },
  { name: 'Mariupol Port', lat: 47.10, lng: 37.55, country: 'UA', priority: 'medium' },

  // China/Taiwan
  { name: 'Fujian PLA Staging Area', lat: 25.90, lng: 119.20, country: 'CN', priority: 'high' },
  { name: 'Hainan Naval Base (Yulin)', lat: 18.22, lng: 109.53, country: 'CN', priority: 'high' },
  { name: 'Mischief Reef (Spratly Islands)', lat: 9.90, lng: 115.53, country: 'CN', priority: 'medium' },
  { name: 'Fiery Cross Reef', lat: 9.55, lng: 112.89, country: 'CN', priority: 'medium' },

  // Middle East
  { name: 'Khmeimim Air Base (Russia in Syria)', lat: 35.40, lng: 35.95, country: 'SY', priority: 'high' },
  { name: 'Natanz Nuclear Facility (Iran)', lat: 33.72, lng: 51.73, country: 'IR', priority: 'high' },
  { name: 'Fordow Nuclear Facility (Iran)', lat: 34.88, lng: 51.59, country: 'IR', priority: 'high' },
  { name: 'Bandar Abbas Naval Base (Iran)', lat: 27.15, lng: 56.28, country: 'IR', priority: 'medium' },
  { name: 'Al Udeid Air Base (Qatar/US)', lat: 25.12, lng: 51.32, country: 'QA', priority: 'medium' },

  // North Korea
  { name: 'Yongbyon Nuclear Complex', lat: 39.80, lng: 125.75, country: 'KP', priority: 'high' },
  { name: 'Sohae Satellite Launch Station', lat: 39.66, lng: 124.71, country: 'KP', priority: 'medium' },
  { name: 'Punggye-ri Nuclear Test Site', lat: 41.28, lng: 129.08, country: 'KP', priority: 'high' },

  // Africa hotspots
  { name: 'Port Sudan', lat: 19.62, lng: 37.22, country: 'SD', priority: 'medium' },
  { name: 'Wagner/Africa Corps Base (Burkina Faso)', lat: 12.37, lng: -1.52, country: 'BF', priority: 'medium' },

  // Strategic chokepoints
  { name: 'Bab el-Mandeb (Yemen side)', lat: 12.58, lng: 43.47, country: 'YE', priority: 'high' },
  { name: 'Suez Canal (Port Said)', lat: 31.26, lng: 32.31, country: 'EG', priority: 'medium' },

  // Europe
  { name: 'Tapa Military Base (Estonia/NATO)', lat: 59.26, lng: 25.97, country: 'EE', priority: 'medium' },
  { name: 'Redzikowo Aegis Ashore (Poland)', lat: 54.48, lng: 17.10, country: 'PL', priority: 'medium' },

  // Belarus
  { name: 'Machulishchy Air Base (Belarus/Wagner)', lat: 53.77, lng: 27.53, country: 'BY', priority: 'high' },

  // Arctic
  { name: 'Nagurskoye Air Base (Franz Josef Land)', lat: 80.80, lng: 47.66, country: 'RU', priority: 'medium' },
];

export class SentinelAdapter extends BaseAdapter {
  source: DataSource = 'sentinel';
  fetchIntervalMinutes = 240; // every 4 hours

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  private async getAccessToken(): Promise<string | null> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    // Method 1: OAuth client credentials (if you have a Sentinel Hub OAuth client)
    const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
    const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;

    if (clientId && clientSecret) {
      try {
        const res = await fetch(
          'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'client_credentials',
              client_id: clientId,
              client_secret: clientSecret,
            }).toString(),
          },
        );
        if (res.ok) {
          const data = await res.json() as { access_token?: string; expires_in?: number };
          if (data.access_token) {
            this.cachedToken = data.access_token;
            this.tokenExpiresAt = Date.now() + ((data.expires_in || 300) - 30) * 1000;
            return this.cachedToken;
          }
        }
      } catch {}
    }

    // Method 2: Password grant with cdse-public client (Copernicus Data Space account)
    const cdseUser = process.env.COPERNICUS_EMAIL;
    const cdsePass = process.env.COPERNICUS_PASSWORD;

    if (cdseUser && cdsePass) {
      try {
        const res = await fetch(
          'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: 'cdse-public',
              username: cdseUser,
              password: cdsePass,
              grant_type: 'password',
            }).toString(),
          },
        );
        if (res.ok) {
          const data = await res.json() as { access_token?: string; expires_in?: number };
          if (data.access_token) {
            this.cachedToken = data.access_token;
            this.tokenExpiresAt = Date.now() + ((data.expires_in || 300) - 30) * 1000;
            this.log('Authenticated via Copernicus Data Space password grant');
            return this.cachedToken;
          }
        }
      } catch {}
    }

    this.warn('Sentinel Hub: set SENTINEL_HUB_CLIENT_ID+SECRET or COPERNICUS_EMAIL+PASSWORD — register free at dataspace.copernicus.eu');
    return null;
  }

  async fetch(): Promise<IntelEvent[]> {
    const token = await this.getAccessToken();
    if (!token) {
      this.warn('Sentinel Hub credentials not set or auth failed — skipping');
      return [];
    }

    const events: IntelEvent[] = [];
    const today = new Date().toISOString().split('T')[0];
    const baseline = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Only check high-priority locations each run to conserve processing units
    const locationsToCheck = WATCH_LOCATIONS.filter(l => l.priority === 'high');

    for (const location of locationsToCheck) {
      try {
        const changeScore = await this.checkLocationChange(token, location, today, baseline);

        if (changeScore !== null && changeScore > 0.15) {
          const severity = Math.min(100, Math.round(changeScore * 200));
          events.push({
            source: 'sentinel',
            type: 'satellite_change',
            severity,
            confidence: 0.7,
            lat: location.lat,
            lng: location.lng,
            country_code: location.country || getCountryFromPosition(location.lat, location.lng),
            timestamp: new Date().toISOString(),
            title: `Satellite change detected: ${location.name}`,
            summary: `Change score: ${(changeScore * 100).toFixed(1)}% vs 14-day baseline. Priority: ${location.priority}`,
            tags: ['sentinel', 'satellite', 'change_detection', location.priority],
            raw_data: { location: location.name, change_score: changeScore, baseline_date: baseline, current_date: today },
          });
        }
      } catch (err) {
        this.error(`Failed to check ${location.name}`, err);
      }
    }

    this.log(`Checked ${locationsToCheck.length} locations, ${events.length} changes detected`);
    return events;
  }

  private async checkLocationChange(
    token: string,
    location: typeof WATCH_LOCATIONS[0],
    currentDate: string,
    baselineDate: string,
  ): Promise<number | null> {
    // Use NDVI difference as a proxy for ground changes
    // (construction, vehicle buildup, clearing all show as NDVI drops)
    const bbox = this.getBBox(location.lat, location.lng, 0.01); // ~1km box

    const evalscript = `
      //VERSION=3
      function setup() {
        return { input: ["B04", "B08"], output: { bands: 1, sampleType: "FLOAT32" } };
      }
      function evaluatePixel(sample) {
        let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04 + 0.001);
        return [ndvi];
      }
    `;

    const requestCurrent = this.buildProcessRequest(bbox, currentDate, evalscript);
    const requestBaseline = this.buildProcessRequest(bbox, baselineDate, evalscript);

    try {
      const [currentRes, baselineRes] = await Promise.all([
        fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestCurrent),
        }),
        fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBaseline),
        }),
      ]);

      if (!currentRes.ok || !baselineRes.ok) {
        // Cloud cover or no imagery available — not an error
        return null;
      }

      // Compare average pixel values between current and baseline
      const currentBuf = await currentRes.arrayBuffer();
      const baselineBuf = await baselineRes.arrayBuffer();

      const currentAvg = this.averageFloat32(currentBuf);
      const baselineAvg = this.averageFloat32(baselineBuf);

      if (baselineAvg === 0) return null;

      // Change score: how much NDVI shifted (absolute difference)
      return Math.abs(currentAvg - baselineAvg);
    } catch {
      return null;
    }
  }

  private buildProcessRequest(bbox: number[], date: string, evalscript: string) {
    return {
      input: {
        bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
        data: [{
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
            maxCloudCoverage: 30,
          },
        }],
      },
      output: { width: 64, height: 64, responses: [{ identifier: 'default', format: { type: 'image/tiff' } }] },
      evalscript,
    };
  }

  private getBBox(lat: number, lng: number, delta: number): number[] {
    return [lng - delta, lat - delta, lng + delta, lat + delta];
  }

  private averageFloat32(buf: ArrayBuffer): number {
    try {
      const view = new Float32Array(buf);
      if (view.length === 0) return 0;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < view.length; i++) {
        if (!isNaN(view[i]) && isFinite(view[i])) {
          sum += view[i];
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    } catch {
      return 0;
    }
  }
}

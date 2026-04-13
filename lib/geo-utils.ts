const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number { return deg * (Math.PI / 180); }
function toDeg(rad: number): number { return rad * (180 / Math.PI); }

/** Haversine distance between two lat/lng points in kilometres. */
export function distanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing (forward azimuth) from point 1 to point 2 in degrees. */
export function bearingTo(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Destination point given start, bearing (degrees), and distance (km). */
export function destinationPoint(
  lat: number, lng: number,
  bearingDeg: number, distKm: number,
): { lat: number; lng: number } {
  const d = distKm / EARTH_RADIUS_KM;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

/** Hours elapsed since a given ISO timestamp. */
export function hoursAgo(isoTimestamp: string, relativeTo?: string): number {
  const then = new Date(isoTimestamp).getTime();
  const now = relativeTo ? new Date(relativeTo).getTime() : Date.now();
  return (now - then) / (1000 * 60 * 60);
}

/** ISO timestamp for N days ago. */
export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Rough country code from lat/lng using bounding-box lookup. */
export function getCountryFromPosition(lat: number, lng: number): string {
  for (const r of ROUGH_COUNTRY_BOXES) {
    if (lat >= r.s && lat <= r.n && lng >= r.w && lng <= r.e) return r.code;
  }
  return 'XX';
}

export interface ChokePoint {
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
}

export const STRATEGIC_CHOKEPOINTS: ChokePoint[] = [
  { name: 'Strait of Hormuz', lat: 26.56, lng: 56.25, radius_km: 100 },
  { name: 'Bab el-Mandeb', lat: 12.58, lng: 43.47, radius_km: 80 },
  { name: 'Strait of Malacca', lat: 2.5, lng: 102.0, radius_km: 150 },
  { name: 'Taiwan Strait', lat: 24.5, lng: 119.5, radius_km: 120 },
  { name: 'Bosphorus', lat: 41.12, lng: 29.08, radius_km: 60 },
  { name: 'Suez Canal', lat: 30.5, lng: 32.35, radius_km: 80 },
  { name: 'Panama Canal', lat: 9.08, lng: -79.68, radius_km: 60 },
  { name: 'Kerch Strait', lat: 45.35, lng: 36.62, radius_km: 50 },
  { name: 'Lombok Strait', lat: -8.77, lng: 115.75, radius_km: 80 },
  { name: 'Luzon Strait', lat: 20.5, lng: 121.5, radius_km: 100 },
  { name: 'GIUK Gap', lat: 63.0, lng: -15.0, radius_km: 200 },
  { name: 'Danish Straits', lat: 55.7, lng: 12.6, radius_km: 60 },
];

const ROUGH_COUNTRY_BOXES: { code: string; n: number; s: number; e: number; w: number }[] = [
  { code: 'US', n: 49.4, s: 24.5, e: -66.9, w: -124.8 },
  { code: 'RU', n: 82.0, s: 41.2, e: 180.0, w: 19.6 },
  { code: 'CN', n: 53.6, s: 18.2, e: 134.8, w: 73.5 },
  { code: 'UA', n: 52.4, s: 44.4, e: 40.2, w: 22.1 },
  { code: 'IR', n: 39.8, s: 25.1, e: 63.3, w: 44.0 },
  { code: 'TW', n: 25.3, s: 21.9, e: 122.0, w: 120.0 },
  { code: 'SY', n: 37.3, s: 32.3, e: 42.4, w: 35.7 },
  { code: 'IQ', n: 37.4, s: 29.1, e: 48.6, w: 38.8 },
  { code: 'KP', n: 43.0, s: 37.7, e: 130.7, w: 124.2 },
  { code: 'IL', n: 33.3, s: 29.5, e: 35.9, w: 34.3 },
  { code: 'YE', n: 19.0, s: 12.1, e: 54.5, w: 42.5 },
  { code: 'BY', n: 56.2, s: 51.3, e: 32.8, w: 23.2 },
  { code: 'PL', n: 54.8, s: 49.0, e: 24.1, w: 14.1 },
  { code: 'GB', n: 60.8, s: 49.9, e: 1.8, w: -8.6 },
  { code: 'DE', n: 55.1, s: 47.3, e: 15.0, w: 5.9 },
  { code: 'FR', n: 51.1, s: 42.3, e: 9.6, w: -5.1 },
  { code: 'IN', n: 35.5, s: 6.7, e: 97.4, w: 68.2 },
  { code: 'JP', n: 45.5, s: 24.2, e: 145.8, w: 122.9 },
  { code: 'KR', n: 38.6, s: 33.1, e: 131.9, w: 124.6 },
  { code: 'BR', n: 5.3, s: -33.8, e: -34.8, w: -73.9 },
  { code: 'AU', n: -10.7, s: -43.6, e: 153.6, w: 113.2 },
  { code: 'SD', n: 22.2, s: 8.7, e: 38.6, w: 21.8 },
  { code: 'MM', n: 28.5, s: 9.8, e: 101.2, w: 92.2 },
  { code: 'ET', n: 14.9, s: 3.4, e: 48.0, w: 33.0 },
  { code: 'NG', n: 13.9, s: 4.3, e: 14.7, w: 2.7 },
  { code: 'VE', n: 12.2, s: 0.6, e: -59.8, w: -73.4 },
  { code: 'PK', n: 37.1, s: 23.7, e: 77.8, w: 60.9 },
  { code: 'AF', n: 38.5, s: 29.4, e: 74.9, w: 60.5 },
];

import { createClient } from '@supabase/supabase-js';
import type { IntelEvent, Anomaly, FogZone } from './types';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

// ── Z-score anomaly detection per source per region ─────────────────────

export async function detectAnomalies(
  events: IntelEvent[],
  windowDays: number = 30,
): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];
  const sb = getSupabase();

  // Group new events by source + country
  const grouped = new Map<string, IntelEvent[]>();
  for (const e of events) {
    const key = `${e.source}:${e.country_code}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(e);
  }

  for (const [key, recentEvents] of grouped) {
    const [source, country] = key.split(':');

    // Get baseline: count of events per day over windowDays
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { count: totalCount } = await sb
      .from('intel_events')
      .select('id', { count: 'exact', head: true })
      .eq('source', source)
      .eq('country_code', country)
      .gte('timestamp', since);

    const total = totalCount || 0;
    const dailyMean = total / windowDays;
    // Rough stddev estimate (Poisson-like: stddev ≈ sqrt(mean))
    const dailyStddev = Math.max(1, Math.sqrt(dailyMean));

    const recentCount = recentEvents.length;
    // Annualize to daily rate for comparison
    const zScore = (recentCount - dailyMean) / dailyStddev;

    if (Math.abs(zScore) > 2.5) {
      anomalies.push({
        source,
        country_code: country,
        z_score: zScore,
        recent_count: recentCount,
        baseline_mean: dailyMean,
        baseline_stddev: dailyStddev,
        direction: zScore > 0 ? 'surge' : 'silence',
        significance: Math.min(100, Math.abs(zScore) * 20),
      });
    }
  }

  console.log(`[anomaly-detector] ${anomalies.length} anomalies detected`);
  return anomalies;
}

// ── Signal absence detection ("Fog of War") ─────────────────────────────

export async function detectSignalAbsences(): Promise<FogZone[]> {
  const sb = getSupabase();
  const fogZones: FogZone[] = [];

  // Check for countries that normally produce conflict/news signals but went quiet
  const sources = ['acled', 'gdelt', 'rss'];
  const hotspotCountries = ['UA', 'SY', 'SD', 'MM', 'YE', 'IQ', 'AF', 'ET', 'NG'];

  for (const country of hotspotCountries) {
    for (const source of sources) {
      // Expected: average daily count over last 14 days
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { count: totalCount } = await sb
        .from('intel_events')
        .select('id', { count: 'exact', head: true })
        .eq('source', source)
        .eq('country_code', country)
        .gte('timestamp', fourteenDaysAgo);

      const dailyExpected = (totalCount || 0) / 14;
      if (dailyExpected < 2) continue; // Not enough baseline

      // Recent: last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: recentCount } = await sb
        .from('intel_events')
        .select('id', { count: 'exact', head: true })
        .eq('source', source)
        .eq('country_code', country)
        .gte('timestamp', oneDayAgo);

      const recent = recentCount || 0;

      // Flag if less than 20% of expected
      if (recent < dailyExpected * 0.2) {
        fogZones.push({
          type: `${source}_silence`,
          lat: 0, // Would need country centroid mapping
          lng: 0,
          radius_km: 500,
          description: `${source.toUpperCase()} signals from ${country} dropped to ${Math.round((recent / dailyExpected) * 100)}% of baseline`,
          last_normal_timestamp: fourteenDaysAgo,
          significance: 75,
        });
      }
    }
  }

  console.log(`[anomaly-detector] ${fogZones.length} fog-of-war zones detected`);
  return fogZones;
}

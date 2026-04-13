import { createClient } from '@supabase/supabase-js';
import type { CountryRiskScore } from './types';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

const INSTABILITY_WEIGHTS: Record<string, number> = {
  conflict_density: 0.25,
  protest_trend: 0.15,
  news_sentiment_shift: 0.15,
  internet_disruption: 0.10,
  military_activity_anomaly: 0.10,
  prediction_market_movement: 0.10,
  sanctions_activity: 0.05,
  historical_baseline_deviation: 0.10,
};

const MONITORED_COUNTRIES = [
  'UA', 'RU', 'CN', 'TW', 'IR', 'SY', 'IQ', 'AF', 'PK', 'KP',
  'IL', 'YE', 'SD', 'MM', 'ET', 'NG', 'BY', 'VE', 'LB', 'LY',
  'ML', 'BF', 'NE', 'SO', 'HT', 'CD', 'MZ', 'PH',
];

async function getComponentScore(
  country: string,
  source: string,
  eventTypes: string[],
  days: number,
): Promise<number> {
  const sb = getSupabase();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = sb
    .from('intel_events')
    .select('severity', { count: 'exact', head: false })
    .eq('country_code', country)
    .gte('timestamp', since);

  if (source !== '*') query = query.eq('source', source);
  if (eventTypes.length > 0) query = query.in('type', eventTypes);

  const { data, count } = await query.limit(100);

  const eventCount = count || 0;
  const avgSeverity = data && data.length > 0
    ? data.reduce((sum: number, e: { severity: number }) => sum + (e.severity || 0), 0) / data.length
    : 0;

  // Normalize: combine count and average severity into 0-100 score
  const countScore = Math.min(100, eventCount * 5);
  const sevScore = avgSeverity;
  return (countScore * 0.6 + sevScore * 0.4);
}

export async function calculateInstabilityScore(countryCode: string): Promise<CountryRiskScore> {
  const components: Record<string, number> = {};

  const [conflictDensity, protestTrend, militaryAnomaly, internetDisruption] = await Promise.all([
    getComponentScore(countryCode, 'acled', ['conflict', 'airstrike'], 7),
    getComponentScore(countryCode, 'acled', ['protest'], 7),
    getComponentScore(countryCode, 'adsb', ['military_flight', 'military_flight_isr', 'tanker_surge'], 7),
    getComponentScore(countryCode, 'ooni', ['internet_shutdown', 'internet_disruption'], 7),
  ]);

  components.conflict_density = conflictDensity;
  components.protest_trend = protestTrend;
  components.military_activity_anomaly = militaryAnomaly;
  components.internet_disruption = internetDisruption;
  components.news_sentiment_shift = await getComponentScore(countryCode, 'gdelt', ['news_signal'], 3);
  components.prediction_market_movement = 0; // Populated when prediction market adapter exists
  components.sanctions_activity = await getComponentScore(countryCode, '*', ['sanctions_new'], 30);
  components.historical_baseline_deviation = 0; // Requires longer history

  const score = Object.entries(components).reduce((sum, [key, value]) => {
    return sum + (value * (INSTABILITY_WEIGHTS[key] || 0));
  }, 0);

  // Get yesterday's score for delta
  const sb = getSupabase();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: prevScore } = await sb
    .from('country_risk_scores')
    .select('score')
    .eq('country_code', countryCode)
    .eq('snapshot_date', yesterday)
    .single();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: weekScore } = await sb
    .from('country_risk_scores')
    .select('score')
    .eq('country_code', countryCode)
    .eq('snapshot_date', weekAgo)
    .single();

  const delta24h = prevScore ? score - prevScore.score : 0;
  const delta7d = weekScore ? score - weekScore.score : 0;

  const trend: CountryRiskScore['instability_trend'] =
    delta24h > 10 ? 'rising_fast' :
    delta24h > 3 ? 'rising' :
    delta24h < -3 ? 'falling' :
    'stable';

  return {
    country_code: countryCode,
    score: Math.round(score * 10) / 10,
    score_delta_24h: Math.round(delta24h * 10) / 10,
    score_delta_7d: Math.round(delta7d * 10) / 10,
    components,
    instability_trend: trend,
    snapshot_date: new Date().toISOString().split('T')[0],
  };
}

export async function calculateAllCountryScores(): Promise<CountryRiskScore[]> {
  const scores: CountryRiskScore[] = [];
  const sb = getSupabase();

  for (const cc of MONITORED_COUNTRIES) {
    try {
      const score = await calculateInstabilityScore(cc);
      scores.push(score);

      await sb.from('country_risk_scores').upsert({
        country_code: score.country_code,
        score: score.score,
        score_delta_24h: score.score_delta_24h,
        score_delta_7d: score.score_delta_7d,
        components: score.components,
        instability_trend: score.instability_trend,
        snapshot_date: score.snapshot_date,
      }, { onConflict: 'country_code,snapshot_date' });
    } catch (err) {
      console.error(`[instability] Failed for ${cc}:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[instability] Scored ${scores.length} countries`);
  return scores;
}

import { createClient } from '@supabase/supabase-js';
import type { IntelEvent, Pattern, PatternMatch, SignalRequirement } from './types';
import { distanceKm } from './geo-utils';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

// ── Pattern definitions ─────────────────────────────────────────────────

export const PATTERNS: Pattern[] = [
  {
    name: 'pre_operational_posture',
    description: 'Multi-domain signals consistent with imminent military operation',
    signals: [
      { type: 'military_flight_isr', minCount: 2, required: true },
      { type: 'tanker_surge', baselineMultiplier: 2.0, required: true },
      { type: 'vessel_dark', minCount: 1, required: false },
      { type: 'notam_closure', required: false },
      { type: 'procurement_munitions', required: false },
    ],
    timeWindowHours: 48,
    radiusKm: 500,
    historicalHitRate: 0.73,
    historicalSampleSize: 11,
    nextEventMedianHours: 24,
    severity: 90,
    alertTier: 'FLASH',
    hypothesisTemplate: 'Military operation being planned or executing in {region}',
  },
  {
    name: 'internet_blackout_conflict',
    description: 'Internet shutdown coinciding with military activity',
    signals: [
      { type: 'internet_shutdown', required: true },
      { source: 'acled', required: false },
      { type: 'military_flight', required: false },
    ],
    timeWindowHours: 24,
    radiusKm: 300,
    historicalHitRate: 0.68,
    historicalSampleSize: 25,
    nextEventMedianHours: 12,
    severity: 85,
    alertTier: 'FLASH',
    hypothesisTemplate: 'Information blackout covering ground operations in {region}',
  },
  {
    name: 'sanctions_evasion_detected',
    description: 'Vessel dark pattern near sanctioned state',
    signals: [
      { type: 'vessel_dark', required: true },
      { source: 'opensanctions', required: false },
    ],
    timeWindowHours: 72,
    radiusKm: 200,
    historicalHitRate: 0.55,
    historicalSampleSize: 40,
    nextEventMedianHours: 48,
    severity: 65,
    alertTier: 'PRIORITY',
    hypothesisTemplate: 'Sanctions evasion operation in {region}',
  },
  {
    name: 'prediction_market_insider',
    description: 'Prediction market odds move sharply before any news',
    signals: [
      { type: 'prediction_market_spike', minSeverity: 70, required: true },
    ],
    timeWindowHours: 6,
    radiusKm: 1000,
    historicalHitRate: 0.62,
    historicalSampleSize: 18,
    nextEventMedianHours: 48,
    severity: 70,
    alertTier: 'PRIORITY',
    hypothesisTemplate: 'Leading indicator of undisclosed development in {region}',
  },
  {
    name: 'doomsday_activation',
    description: 'Nuclear command aircraft airborne — DEFCON watch',
    signals: [
      { type: 'doomsday_plane', required: true },
    ],
    timeWindowHours: 1,
    radiusKm: 5000,
    historicalHitRate: 0.15,
    historicalSampleSize: 8,
    nextEventMedianHours: 0,
    severity: 100,
    alertTier: 'FLASH',
    hypothesisTemplate: 'Nuclear command elevation — assess DEFCON status',
  },
  {
    name: 'io_campaign_detected',
    description: 'Coordinated identical narrative across unrelated sources',
    signals: [
      { type: 'narrative_cluster', minCount: 3, required: true },
    ],
    timeWindowHours: 12,
    radiusKm: 5000,
    historicalHitRate: 0.80,
    historicalSampleSize: 15,
    nextEventMedianHours: 24,
    severity: 60,
    alertTier: 'PRIORITY',
    hypothesisTemplate: 'Coordinated information operation targeting {region}',
  },
  {
    name: 'hospital_ship_deployment',
    description: 'Hospital ship moves far from home port — pre-conflict indicator',
    signals: [
      { type: 'hospital_ship_movement', required: true },
    ],
    timeWindowHours: 168,
    radiusKm: 2000,
    historicalHitRate: 0.71,
    historicalSampleSize: 7,
    nextEventMedianHours: 336,
    severity: 80,
    alertTier: 'PRIORITY',
    hypothesisTemplate: 'Operational preparation in {region} — hospital ship deployed',
  },
  {
    name: 'procurement_surge',
    description: 'Unusual spike in military procurement — munitions, medical, or interpreters',
    signals: [
      { type: 'procurement_munitions', minCount: 2, required: false },
      { type: 'procurement_medical', required: false },
      { type: 'procurement_interpreters', required: false },
    ],
    timeWindowHours: 168,
    radiusKm: 5000,
    historicalHitRate: 0.58,
    historicalSampleSize: 12,
    nextEventMedianHours: 720,
    severity: 70,
    alertTier: 'DAILY',
    hypothesisTemplate: 'Military procurement anomaly — possible operational preparation',
  },
];

// ── Signal matching ─────────────────────────────────────────────────────

function signalMatchesRequirement(event: IntelEvent, req: SignalRequirement): boolean {
  if (req.source && event.source !== req.source) return false;
  if (req.type && event.type !== req.type) return false;
  if (req.minSeverity && event.severity < req.minSeverity) return false;
  return true;
}

function patternMatches(pattern: Pattern, events: IntelEvent[]): boolean {
  for (const req of pattern.signals) {
    if (!req.required) continue;

    const matching = events.filter(e => signalMatchesRequirement(e, req));
    const minCount = req.minCount || 1;

    if (matching.length < minCount) return false;
  }
  return true;
}

function calculateCompositeSeverity(pattern: Pattern, events: IntelEvent[]): number {
  const avgEventSeverity = events.reduce((sum, e) => sum + e.severity, 0) / events.length;
  const domainCount = new Set(events.map(e => e.source)).size;
  const domainBonus = domainCount * 5;
  return Math.min(100, (pattern.severity * 0.6) + (avgEventSeverity * 0.3) + domainBonus);
}

// ── Main execution ──────────────────────────────────────────────────────

export async function runRulesEngine(
  newEvents: IntelEvent[],
): Promise<PatternMatch[]> {
  if (newEvents.length === 0) return [];

  const matches: PatternMatch[] = [];
  const sb = getSupabase();

  // Get recent events from DB for wider time window matching
  const { data: recentDb } = await sb
    .from('intel_events')
    .select('source, type, severity, confidence, country_code, timestamp, title, summary, tags')
    .gte('timestamp', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    .order('timestamp', { ascending: false })
    .limit(1000);

  const allRecent: IntelEvent[] = [
    ...newEvents,
    ...((recentDb || []) as IntelEvent[]).map(e => ({
      ...e,
      lat: 0,
      lng: 0,
      raw_data: {},
      tags: e.tags || [],
    })),
  ];

  for (const pattern of PATTERNS) {
    // Get events within the pattern's time window
    const cutoff = new Date(Date.now() - pattern.timeWindowHours * 60 * 60 * 1000).toISOString();
    const windowEvents = allRecent.filter(e => e.timestamp >= cutoff);

    // Group by country for regional pattern matching
    const byCountry = new Map<string, IntelEvent[]>();
    for (const e of windowEvents) {
      const cc = e.country_code || 'XX';
      if (!byCountry.has(cc)) byCountry.set(cc, []);
      byCountry.get(cc)!.push(e);
    }

    // Also check global patterns (no country grouping)
    if (pattern.radiusKm >= 5000) {
      if (patternMatches(pattern, windowEvents)) {
        matches.push({
          pattern,
          events: windowEvents.filter(e =>
            pattern.signals.some(s => signalMatchesRequirement(e, s)),
          ).slice(0, 20),
          region: { lat: 0, lng: 0, name: 'Global' },
          matched_at: new Date().toISOString(),
          composite_severity: calculateCompositeSeverity(pattern, windowEvents),
        });
      }
    }

    // Check per-country
    for (const [cc, countryEvents] of byCountry) {
      if (patternMatches(pattern, countryEvents)) {
        const relevantEvents = countryEvents.filter(e =>
          pattern.signals.some(s => signalMatchesRequirement(e, s)),
        ).slice(0, 20);

        matches.push({
          pattern,
          events: relevantEvents,
          region: {
            lat: relevantEvents[0]?.lat || 0,
            lng: relevantEvents[0]?.lng || 0,
            name: cc,
          },
          matched_at: new Date().toISOString(),
          composite_severity: calculateCompositeSeverity(pattern, relevantEvents),
        });
      }
    }
  }

  // Deduplicate: one match per pattern per region
  const seen = new Set<string>();
  const deduped = matches.filter(m => {
    const key = `${m.pattern.name}:${m.region.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Store correlations
  for (const match of deduped) {
    await sb.from('correlations').insert({
      pattern_name: match.pattern.name,
      event_ids: match.events.map(e => e.id).filter(Boolean),
      sources: [...new Set(match.events.map(e => e.source))],
      region: match.region.name,
      country_code: match.region.name?.length === 2 ? match.region.name : null,
      time_window_hours: match.pattern.timeWindowHours,
      severity_composite: match.composite_severity,
    });
  }

  console.log(`[rules-engine] ${deduped.length} pattern matches from ${newEvents.length} new events`);
  return deduped;
}

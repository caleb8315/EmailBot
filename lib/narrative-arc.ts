import { createClient } from '@supabase/supabase-js';
import type { IntelEvent, NarrativeArc } from './types';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

// ── Historical patterns ─────────────────────────────────────────────────

interface HistoricalPattern {
  name: string;
  acts: { number: number; name: string; description: string; event_types: string[] }[];
  median_hours_between_acts: number[];
  historical_completion_rate: number;
  historical_examples: string[];
}

export const HISTORICAL_PATTERNS: HistoricalPattern[] = [
  {
    name: 'classic_escalation_ladder',
    acts: [
      { number: 1, name: 'Border Incident', description: 'Minor kinetic event or provocation at border', event_types: ['conflict', 'military_flight'] },
      { number: 2, name: 'Troop Buildup', description: 'Visible military positioning begins', event_types: ['military_flight_isr', 'tanker_surge', 'military_flight'] },
      { number: 3, name: 'Communications Blackout', description: 'Internet/communications disruption in region', event_types: ['internet_shutdown', 'internet_disruption'] },
      { number: 4, name: 'Escalation', description: 'Kinetic action or major political move', event_types: ['airstrike', 'conflict'] },
      { number: 5, name: 'Resolution or Freeze', description: 'Ceasefire, talks, or frozen conflict', event_types: ['news_signal'] },
    ],
    median_hours_between_acts: [48, 72, 12, 168],
    historical_completion_rate: 0.68,
    historical_examples: ['Georgia 2008', 'Crimea 2014', 'Armenia-Azerbaijan 2020'],
  },
  {
    name: 'coup_sequence',
    acts: [
      { number: 1, name: 'Leadership Dispute', description: 'Public political crisis or arrest of officials', event_types: ['news_signal', 'protest'] },
      { number: 2, name: 'Military Positioning', description: 'Unusual military movements in capital', event_types: ['military_flight', 'military_flight_isr'] },
      { number: 3, name: 'Communications Control', description: 'State media taken over, internet disrupted', event_types: ['internet_shutdown', 'internet_disruption'] },
      { number: 4, name: 'Power Transfer Attempt', description: 'Coup declared or suppressed', event_types: ['conflict', 'news_signal'] },
    ],
    median_hours_between_acts: [72, 12, 2],
    historical_completion_rate: 0.45,
    historical_examples: ['Sudan 2019', 'Myanmar 2021', 'Niger 2023'],
  },
  {
    name: 'sanctions_evasion_network',
    acts: [
      { number: 1, name: 'Sanctions Imposed', description: 'New sanctions on entity/country', event_types: ['sanctions_new', 'news_signal'] },
      { number: 2, name: 'Dark Fleet Activation', description: 'Vessels go dark, flag changes detected', event_types: ['vessel_dark', 'vessel_anomaly'] },
      { number: 3, name: 'Transfer Network', description: 'Ship-to-ship transfers detected at sea', event_types: ['vessel_transfer', 'vessel_anomaly'] },
      { number: 4, name: 'Front Company Creation', description: 'New entities appear in sanctions lists', event_types: ['sanctions_new'] },
    ],
    median_hours_between_acts: [168, 336, 720],
    historical_completion_rate: 0.82,
    historical_examples: ['Iran oil 2019', 'Russia oil 2022', 'North Korea 2023'],
  },
  {
    name: 'humanitarian_crisis_spiral',
    acts: [
      { number: 1, name: 'Conflict Intensification', description: 'Uptick in violence or displacement', event_types: ['conflict', 'airstrike'] },
      { number: 2, name: 'Infrastructure Targeting', description: 'Hospitals, water, power hit', event_types: ['fire', 'conflict'] },
      { number: 3, name: 'Displacement Wave', description: 'Mass movement of people begins', event_types: ['news_signal', 'protest'] },
      { number: 4, name: 'International Response', description: 'Aid mobilization or UN action', event_types: ['news_signal', 'hospital_ship_movement'] },
    ],
    median_hours_between_acts: [72, 168, 336],
    historical_completion_rate: 0.75,
    historical_examples: ['Aleppo 2016', 'Tigray 2020', 'Gaza 2023'],
  },
];

// ── Detect and update arcs ──────────────────────────────────────────────

function eventMatchesAct(
  event: IntelEvent,
  act: { event_types: string[] },
): boolean {
  return act.event_types.includes(event.type);
}

export async function detectAndUpdateNarrativeArcs(
  newEvents: IntelEvent[],
): Promise<{ advanced: number; created: number }> {
  const sb = getSupabase();
  let advanced = 0;
  let created = 0;

  // Check if new events advance existing arcs
  const { data: activeArcs } = await sb
    .from('narrative_arcs')
    .select('*')
    .eq('status', 'active');

  for (const rawArc of activeArcs || []) {
    const arc = rawArc as NarrativeArc;
    const pattern = HISTORICAL_PATTERNS.find(p => p.name === arc.pattern_matched);
    if (!pattern) continue;

    const nextActIndex = arc.current_act; // 0-indexed next act
    if (nextActIndex >= pattern.acts.length) continue;
    const nextAct = pattern.acts[nextActIndex];

    const matchingEvents = newEvents.filter(e => {
      if (!eventMatchesAct(e, nextAct)) return false;
      // Country/region match
      if (arc.region && e.country_code && arc.region !== e.country_code) return false;
      return true;
    });

    if (matchingEvents.length > 0) {
      const newActDesc = [...(arc.act_descriptions || [])];
      newActDesc.push({
        act: nextActIndex + 1,
        title: nextAct.name,
        description: nextAct.description,
        started_at: new Date().toISOString(),
      });

      const nextNextAct = pattern.acts[nextActIndex + 1];

      await sb
        .from('narrative_arcs')
        .update({
          current_act: arc.current_act + 1,
          act_descriptions: newActDesc,
          event_ids: [...(arc.event_ids || []), ...matchingEvents.map(e => e.id).filter(Boolean)],
          next_act_predicted: nextNextAct?.name || 'Resolution',
          next_act_median_hours: pattern.median_hours_between_acts[nextActIndex] || null,
          last_updated: new Date().toISOString(),
          status: nextActIndex + 1 >= pattern.acts.length ? 'resolved' : 'active',
        })
        .eq('id', arc.id);

      advanced++;
    }
  }

  // Check if new events start new arcs (Act 1 pattern match)
  for (const pattern of HISTORICAL_PATTERNS) {
    const act1 = pattern.acts[0];

    const byCountry = new Map<string, IntelEvent[]>();
    for (const e of newEvents) {
      if (!eventMatchesAct(e, act1)) continue;
      const cc = e.country_code || 'XX';
      if (!byCountry.has(cc)) byCountry.set(cc, []);
      byCountry.get(cc)!.push(e);
    }

    for (const [cc, events] of byCountry) {
      if (events.length < 2) continue; // Need multiple signals for Act 1

      // Check if we already have an active arc of this pattern for this country
      const existing = (activeArcs || []).find(
        a => a.pattern_matched === pattern.name && a.region === cc,
      );
      if (existing) continue;

      await sb.from('narrative_arcs').insert({
        title: `${pattern.name.replace(/_/g, ' ')} — ${cc}`,
        current_act: 1,
        total_acts: pattern.acts.length,
        act_descriptions: [{
          act: 1,
          title: act1.name,
          description: act1.description,
          started_at: new Date().toISOString(),
        }],
        pattern_matched: pattern.name,
        historical_matches: pattern.historical_examples.map(e => ({ name: e })),
        historical_accuracy: pattern.historical_completion_rate,
        next_act_predicted: pattern.acts[1]?.name || null,
        next_act_median_hours: pattern.median_hours_between_acts[0] || null,
        actors: {},
        event_ids: events.map(e => e.id).filter(Boolean),
        region: cc,
        status: 'active',
      });

      created++;
    }
  }

  console.log(`[narrative-arc] ${advanced} arcs advanced, ${created} new arcs created`);
  return { advanced, created };
}

export async function getActiveArcs(): Promise<NarrativeArc[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('narrative_arcs')
    .select('*')
    .eq('status', 'active')
    .order('last_updated', { ascending: false });
  return (data || []) as NarrativeArc[];
}

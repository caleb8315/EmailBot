import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Belief, Hypothesis, DreamtimeScenario } from './types';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

import { callLLM as sharedCallLLM } from './llm';

async function callDreamtimeLLM(prompt: string): Promise<string> {
  return sharedCallLLM(prompt, 'dreamtime', { json: true });
}

function buildDreamtimeContext(
  beliefs: Belief[],
  hypotheses: Hypothesis[],
  recentEventSummary: string,
): string {
  const beliefList = beliefs
    .slice(0, 15)
    .map(b => `- "${b.statement}" (${Math.round(b.confidence * 100)}% confidence, ${b.jeff_stake || 'MEDIUM'} stake)`)
    .join('\n');

  const hypothesisList = hypotheses
    .slice(0, 10)
    .map(h => `- "${h.title}" (${Math.round(h.confidence * 100)}%)`)
    .join('\n');

  return `
CURRENT BELIEFS (top 15 by confidence):
${beliefList || '(no beliefs formed yet)'}

ACTIVE HYPOTHESES:
${hypothesisList || '(no hypotheses active)'}

RECENT EVENT SUMMARY (last 72 hours):
${recentEventSummary || '(limited recent data)'}
  `.trim();
}

export async function runDreamtimeEngine(): Promise<DreamtimeScenario[]> {
  console.log('[dreamtime] === DREAMTIME ENGINE STARTING ===');

  const sb = getSupabase();

  // Load current world model
  const { data: beliefs } = await sb
    .from('beliefs')
    .select('*')
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .limit(20);

  const { data: hypotheses } = await sb
    .from('hypotheses')
    .select('*')
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .limit(10);

  // Get recent event type summary
  const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data: recentEvents } = await sb
    .from('intel_events')
    .select('source, type, severity, country_code, title')
    .gte('timestamp', threeDaysAgo)
    .gte('severity', 40)
    .order('severity', { ascending: false })
    .limit(30);

  const eventSummary = (recentEvents || [])
    .map(e => `- [${e.source}/${e.type}] ${e.title} (severity ${e.severity}, ${e.country_code})`)
    .join('\n');

  const context = buildDreamtimeContext(
    (beliefs || []) as Belief[],
    (hypotheses || []) as Hypothesis[],
    eventSummary,
  );

  try {
    const response = await callDreamtimeLLM(`
You are Jeff's Dreamtime Engine. It is 3am. You have access to Jeff's full current world model.
Your job is to find what everyone is missing.

Current world state:
${context}

Generate exactly 3 scenarios as a JSON object with a "scenarios" array. Each scenario must have:
- scenario_type: "wildcard" | "underrated" | "fading_consensus"
- title: max 10 words
- narrative: 2-3 paragraphs (evidence, mechanism, implications)
- probability: your estimate (0.0-1.0)
- market_implied_probability: what you think markets/consensus believes (0.0-1.0)
- signal_chain: array of 3-5 specific signals supporting this
- impact_level: "extreme" | "high" | "medium"

Scenario 1 (WILDCARD): Low-probability (2-8%) but HIGH impact. Something nobody is discussing but signals support.
Scenario 2 (UNDERRATED): 20-35% probability that consensus prices under 10%. Why is everyone wrong?
Scenario 3 (FADING_CONSENSUS): The thing everyone expects — explain why it won't happen.

Return only valid JSON with a "scenarios" array.
    `);

    const parsed = JSON.parse(response) as { scenarios: DreamtimeScenario[] };
    const scenarios = (parsed.scenarios || []).map(s => ({
      ...s,
      generated_date: new Date().toISOString().split('T')[0],
    }));

    // Store scenarios
    for (const scenario of scenarios) {
      await sb.from('dreamtime_scenarios').insert({
        generated_date: scenario.generated_date,
        scenario_type: scenario.scenario_type,
        title: scenario.title,
        narrative: scenario.narrative,
        probability: scenario.probability,
        market_implied_probability: scenario.market_implied_probability,
        jeff_probability: scenario.probability,
        signal_chain: scenario.signal_chain,
        impact_level: scenario.impact_level,
        user_read: false,
      });
    }

    console.log(`[dreamtime] Generated ${scenarios.length} scenarios`);
    return scenarios;
  } catch (err) {
    console.error('[dreamtime] Failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

// CLI entry point
if (require.main === module) {
  runDreamtimeEngine()
    .then(scenarios => {
      console.log(`[dreamtime] Complete. ${scenarios.length} scenarios generated.`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[dreamtime] Fatal:', err);
      process.exit(1);
    });
}

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { IngestionAdapter } from './adapters/base-adapter';
import type { IntelEvent } from './types';

import { RSSAdapter } from './adapters/rss-adapter';
import { GDELTAdapter } from './adapters/gdelt';
import { ACLEDAdapter } from './adapters/acled';
import { USGSAdapter } from './adapters/usgs';
import { FIRMSAdapter } from './adapters/firms';

import { runRulesEngine } from './rules-engine';
import { evaluateAllBeliefsAgainstNewEvents } from './belief-engine';
import { updateAllHypotheses } from './hypothesis-board';
import { detectAndUpdateNarrativeArcs } from './narrative-arc';
import { detectAnomalies } from './anomaly-detector';
import { dispatchPatternAlert, dispatchAnomalyAlert, buildStructuredPrompt } from './alerts';
import { callLLM } from './llm';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

function getAllAdapters(): IngestionAdapter[] {
  return [
    new RSSAdapter(),
    new GDELTAdapter(),
    new ACLEDAdapter(),
    new USGSAdapter(),
    new FIRMSAdapter(),
    // Phase 1.5+ adapters will be added here
  ];
}

async function storeEvents(events: IntelEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const sb = getSupabase();
  let stored = 0;

  // Batch insert in chunks of 200 to stay within Supabase limits
  for (let i = 0; i < events.length; i += 200) {
    const batch = events.slice(i, i + 200).map(e => ({
      source: e.source,
      type: e.type,
      severity: e.severity,
      confidence: e.confidence,
      location: e.lat && e.lng ? `POINT(${e.lng} ${e.lat})` : null,
      radius_km: e.radius_km ?? null,
      country_code: e.country_code,
      timestamp: e.timestamp,
      expires_at: e.expires_at ?? null,
      title: e.title.slice(0, 500),
      summary: (e.summary || '').slice(0, 2000),
      raw_data: e.raw_data,
      tags: e.tags,
      related_event_ids: e.related_event_ids ?? null,
    }));

    const { error, count } = await sb
      .from('intel_events')
      .insert(batch)
      .select('id');

    if (error) {
      console.error(`[ingest] Store batch error: ${error.message}`);
    } else {
      stored += count ?? batch.length;
    }
  }

  return stored;
}

async function cleanupExpiredEvents(): Promise<void> {
  const sb = getSupabase();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await sb
    .from('intel_events')
    .delete()
    .lt('created_at', cutoff);

  if (error) {
    console.error(`[ingest] Cleanup error: ${error.message}`);
  }
}

export async function runIngestion(): Promise<{
  totalFetched: number;
  totalStored: number;
  adapterResults: { source: string; fetched: number; errors: string[] }[];
}> {
  const startTime = Date.now();
  console.log(`[ingest] === INGESTION CYCLE STARTING ===`);

  const adapters = getAllAdapters();
  const allEvents: IntelEvent[] = [];
  const adapterResults: { source: string; fetched: number; errors: string[] }[] = [];

  // Run all adapters in parallel
  const results = await Promise.allSettled(
    adapters.map(async adapter => {
      const adapterStart = Date.now();
      try {
        const events = await adapter.fetch();
        console.log(`[ingest] ${adapter.source}: ${events.length} events in ${Date.now() - adapterStart}ms`);
        return { source: adapter.source, events, errors: [] as string[] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ingest] ${adapter.source}: FAILED — ${msg}`);
        return { source: adapter.source, events: [] as IntelEvent[], errors: [msg] };
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value.events);
      adapterResults.push({
        source: result.value.source,
        fetched: result.value.events.length,
        errors: result.value.errors,
      });
    }
  }

  // Filter to only significant events (severity > 15) to manage row budget
  const significant = allEvents.filter(e => e.severity > 15);

  // Deduplicate: skip events with titles we already stored in the last 24h
  const sb = getSupabase();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentTitles } = await sb
    .from('intel_events')
    .select('title')
    .gte('created_at', oneDayAgo)
    .limit(2000);
  const existingTitles = new Set((recentTitles || []).map(r => r.title));
  const deduped = significant.filter(e => !existingTitles.has(e.title));
  console.log(`[ingest] ${allEvents.length} total → ${significant.length} significant → ${deduped.length} after dedup`);

  // Store to Supabase
  let totalStored = 0;
  try {
    totalStored = await storeEvents(deduped);
  } catch (err) {
    console.error(`[ingest] Storage failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Intelligence loop: Rules → Beliefs → Hypotheses → Arcs → Anomalies → Alerts ──
  if (significant.length > 0) {
    try {
      // 1. Rules engine: detect patterns
      const patternMatches = await runRulesEngine(significant);
      console.log(`[ingest] Rules engine: ${patternMatches.length} pattern matches`);

      // 2. Generate narratives and dispatch alerts for pattern matches
      for (const match of patternMatches) {
        try {
          const prompt = buildStructuredPrompt(match);
          const narrative = await callLLM(prompt, 'narrative');
          await dispatchPatternAlert(match, narrative);
        } catch (err) {
          console.error(`[ingest] Alert dispatch failed:`, err instanceof Error ? err.message : String(err));
        }
      }

      // 3. Update beliefs against new events
      const beliefResult = await evaluateAllBeliefsAgainstNewEvents(significant);
      console.log(`[ingest] Beliefs updated: ${beliefResult.updated}, conflicts: ${beliefResult.conflictsFound}`);

      // 4. Update hypotheses
      const hypoUpdated = await updateAllHypotheses(significant);
      console.log(`[ingest] Hypotheses updated: ${hypoUpdated}`);

      // 5. Check narrative arcs
      const arcResult = await detectAndUpdateNarrativeArcs(significant);
      console.log(`[ingest] Arcs: ${arcResult.advanced} advanced, ${arcResult.created} created`);

      // 6. Anomaly detection
      const anomalies = await detectAnomalies(significant);
      for (const anomaly of anomalies) {
        await dispatchAnomalyAlert(anomaly);
      }
    } catch (err) {
      console.error(`[ingest] Intelligence loop error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Weekly cleanup of expired events
  if (new Date().getHours() === 4) {
    try {
      await cleanupExpiredEvents();
      console.log('[ingest] Expired events cleaned up');
    } catch (err) {
      console.error(`[ingest] Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[ingest] === CYCLE COMPLETE: ${totalStored} stored in ${elapsed}ms ===`);

  return { totalFetched: allEvents.length, totalStored, adapterResults };
}

// CLI entry point
if (require.main === module) {
  runIngestion()
    .then(result => {
      console.log('[ingest] Result:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[ingest] Fatal:', err);
      process.exit(1);
    });
}

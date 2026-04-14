import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { IngestionAdapter } from './adapters/base-adapter';
import type { IntelEvent } from './types';

import { RSSAdapter } from './adapters/rss-adapter';
import { GDELTAdapter } from './adapters/gdelt';
import { GDELTEventsAdapter } from './adapters/gdelt-events';
import { ConflictRSSAdapter } from './adapters/reliefweb';
import { ACLEDAdapter } from './adapters/acled';
import { USGSAdapter } from './adapters/usgs';
import { FIRMSAdapter } from './adapters/firms';
import { SentinelAdapter } from './adapters/sentinel';
import { ADSBMilitaryAdapter } from './adapters/adsb-military';
import { NOTAMAdapter } from './adapters/notam';
import { OONIAdapter } from './adapters/ooni';
import { PolymarketAdapter } from './adapters/polymarket';
import { UCDPAdapter } from './adapters/ucdp';
import { NASAEONETAdapter } from './adapters/nasa-eonet';
import { OSINTFeedsAdapter } from './adapters/osint-feeds';
import { AISDarkShipAdapter } from './adapters/ais-dark-ship';
import { SAMGovAdapter } from './adapters/samgov';
import { CISAAdapter } from './adapters/cisa';
import { EMSCAdapter } from './adapters/emsc';
import { GVPAdapter } from './adapters/gvp';
import { ReliefWebDisastersAdapter } from './adapters/reliefweb-disasters';
import { NHCAdapter } from './adapters/nhc';

import { runRulesEngine } from './rules-engine';
import { evaluateAllBeliefsAgainstNewEvents } from './belief-engine';
import { updateAllHypotheses } from './hypothesis-board';
import { detectAndUpdateNarrativeArcs } from './narrative-arc';
import { detectAnomalies } from './anomaly-detector';
import { dispatchPatternAlert, dispatchAnomalyAlert, buildStructuredPrompt } from './alerts';
import { callLLM } from './llm';
import {
  assignVerificationToEvent,
  recheckVerification,
  isQuarantineExpired,
  canAlert,
  isDomainCredible,
  extractCanonicalDomain,
} from './verification';

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
    new GDELTEventsAdapter(),
    new ConflictRSSAdapter(),
    new ACLEDAdapter(),
    new UCDPAdapter(),
    new NASAEONETAdapter(),
    new OSINTFeedsAdapter(),
    new USGSAdapter(),
    new FIRMSAdapter(),
    new ADSBMilitaryAdapter(),
    new SentinelAdapter(),
    new NOTAMAdapter(),
    new OONIAdapter(),
    new PolymarketAdapter(),
    new AISDarkShipAdapter(),
    new SAMGovAdapter(),
    new CISAAdapter(),
    new EMSCAdapter(),
    new GVPAdapter(),
    new ReliefWebDisastersAdapter(),
    new NHCAdapter(),
  ];
}

function computeExpiry(severity: number, type: string, verificationStatus?: string): string {
  let ttlHours: number;

  if (verificationStatus === 'quarantined' || verificationStatus === 'blocked') {
    ttlHours = 24;
  } else if (verificationStatus === 'verified') {
    // Verified events persist much longer for hypothesis/narrative engines
    if (severity >= 85) ttlHours = 90 * 24;  // 90 days
    else if (severity >= 70) ttlHours = 60 * 24; // 60 days
    else if (severity >= 50) ttlHours = 30 * 24; // 30 days
    else ttlHours = 14 * 24; // 14 days
  } else if (verificationStatus === 'developing') {
    if (severity >= 70) ttlHours = 30 * 24; // 30 days
    else if (severity >= 50) ttlHours = 14 * 24; // 14 days
    else ttlHours = 7 * 24; // 7 days
  } else {
    // Unverified — short retention but enough to get rechecked
    if (severity >= 85) ttlHours = 72;
    else if (severity >= 70) ttlHours = 48;
    else if (severity >= 50) ttlHours = 24;
    else if (severity >= 30) ttlHours = 12;
    else ttlHours = 6;
  }

  if (type === 'earthquake' || type === 'fire') ttlHours = Math.max(ttlHours, 24);
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
}

async function storeEvents(events: IntelEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const sb = getSupabase();
  let stored = 0;

  // Batch insert in chunks of 200 to stay within Supabase limits
  for (let i = 0; i < events.length; i += 200) {
    const batch = events.slice(i, i + 200).map(e => {
      const hasCoords = typeof e.lat === 'number' && typeof e.lng === 'number' &&
                        isFinite(e.lat) && isFinite(e.lng) &&
                        Math.abs(e.lat) <= 90 && Math.abs(e.lng) <= 180 &&
                        !(e.lat === 0 && e.lng === 0);
      const expiresAt = e.expires_at ?? computeExpiry(e.severity, e.type, e.verification?.status);
      return {
        source: e.source,
        type: e.type,
        severity: e.severity,
        confidence: e.confidence,
        location: hasCoords ? `POINT(${e.lng} ${e.lat})` : null,
        radius_km: e.radius_km ?? null,
        country_code: e.country_code,
        timestamp: e.timestamp,
        expires_at: expiresAt,
        title: e.title.slice(0, 500),
        summary: (e.summary || '').slice(0, 2000),
        raw_data: e.raw_data,
        tags: e.tags,
        related_event_ids: e.related_event_ids ?? null,
      };
    });

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
  const now = new Date().toISOString();
  // Hard cutoff: 90 days for everything (verified events set their own expiry up to 90d)
  const hardCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  // Quarantined events that never got promoted — clean up after 3 days
  const quarantineCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Remove events past their individual expiry
  const { error: e1 } = await sb
    .from('intel_events')
    .delete()
    .not('expires_at', 'is', null)
    .lt('expires_at', now);

  // 2. Remove stale quarantined events that were never promoted
  const { error: e2 } = await sb
    .from('intel_events')
    .delete()
    .contains('tags', ['quarantined'])
    .lt('created_at', quarantineCutoff);

  // 3. Hard cutoff for anything older than 90 days
  const { error: e3 } = await sb
    .from('intel_events')
    .delete()
    .lt('created_at', hardCutoff);

  if (e1) console.error(`[ingest] Cleanup (expires_at) error: ${e1.message}`);
  if (e2) console.error(`[ingest] Cleanup (quarantine) error: ${e2.message}`);
  if (e3) console.error(`[ingest] Cleanup (hard cutoff) error: ${e3.message}`);
  if (!e1 && !e2 && !e3) console.log(`[ingest] Cleanup: expired, quarantined, and old events removed`);
}

export async function runIngestion(): Promise<{
  totalFetched: number;
  totalStored: number;
  adapterResults: { source: string; fetched: number; errors: string[] }[];
}> {
  const { startEngineRun, finishEngineRun } = await import('./shared/engine-run');
  const engineRunId = await startEngineRun('world_ingest');
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

  // Deduplicate using composite key: source + title + country_code
  const sb = getSupabase();
  const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data: recentRows } = await sb
    .from('intel_events')
    .select('title, source, country_code, raw_data')
    .gte('created_at', threeDaysAgo)
    .limit(5000);
  const existingKeys = new Set<string>();
  const existingEventIds = new Set<string>();
  for (const r of recentRows || []) {
    existingKeys.add(`${r.source}|${r.title}|${r.country_code ?? ''}`);
    const eid = (r.raw_data as Record<string, unknown>)?.event_id;
    if (typeof eid === 'string') existingEventIds.add(`${r.source}|${eid}`);
  }
  const deduped = significant.filter(e => {
    const compositeKey = `${e.source}|${e.title}|${e.country_code ?? ''}`;
    const eidKey = e.raw_data?.event_id ? `${e.source}|${e.raw_data.event_id}` : '';
    if (existingKeys.has(compositeKey)) return false;
    if (eidKey && existingEventIds.has(eidKey)) return false;
    existingKeys.add(compositeKey);
    if (eidKey) existingEventIds.add(eidKey);
    return true;
  });
  // ── Verification gate: assign verification status and split into verified vs quarantined ──
  const verified: IntelEvent[] = [];
  const quarantined: IntelEvent[] = [];
  for (const event of deduped) {
    const checked = assignVerificationToEvent(event);
    if (checked.verification?.status === 'quarantined') {
      quarantined.push(checked);
    } else {
      verified.push(checked);
    }
  }
  console.log(`[ingest] ${allEvents.length} total → ${significant.length} significant → ${deduped.length} deduped → ${verified.length} verified, ${quarantined.length} quarantined`);

  // Store verified events to Supabase
  let totalStored = 0;
  try {
    totalStored = await storeEvents(verified);
  } catch (err) {
    console.error(`[ingest] Storage failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Store quarantined events separately (tagged for recheck)
  if (quarantined.length > 0) {
    try {
      const quarantinedTagged = quarantined.map(e => ({
        ...e,
        tags: [...e.tags, 'quarantined'],
      }));
      await storeEvents(quarantinedTagged);
      console.log(`[ingest] Stored ${quarantined.length} quarantined events for later recheck`);
    } catch (err) {
      console.error(`[ingest] Quarantine storage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Quarantine recheck: try to promote previously quarantined events ──
  try {
    const { data: pendingRows } = await sb
      .from('intel_events')
      .select('id, title, source, type, severity, confidence, country_code, timestamp, summary, tags, raw_data')
      .contains('tags', ['quarantined'])
      .gte('created_at', threeDaysAgo)
      .limit(200);

    if (pendingRows && pendingRows.length > 0) {
      let promoted = 0;
      for (const row of pendingRows) {
        const titleWords = row.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        const matchingNew = verified.filter(e =>
          titleWords.some((w: string) => e.title.toLowerCase().includes(w))
        );
        if (matchingNew.length > 0) {
          const newTags = (row.tags as string[]).filter((t: string) => t !== 'quarantined');
          newTags.push('promoted_from_quarantine');
          await sb.from('intel_events').update({ tags: newTags }).eq('id', row.id);
          promoted++;
        }
      }
      if (promoted > 0) {
        console.log(`[ingest] Quarantine recheck: promoted ${promoted} events`);
      }
    }
  } catch (err) {
    console.error(`[ingest] Quarantine recheck failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Intelligence loop: Rules → Beliefs → Hypotheses → Arcs → Anomalies → Alerts ──
  // Only run intelligence loop on verified/developing events
  if (verified.length > 0) {
    try {
      // 1. Rules engine: detect patterns
      const patternMatches = await runRulesEngine(verified);
      console.log(`[ingest] Rules engine: ${patternMatches.length} pattern matches`);

      // 2. Generate narratives and dispatch alerts for pattern matches
      for (const match of patternMatches) {
        try {
          const allEventsVerified = match.events.every(
            e => e.verification?.status === 'verified' || e.verification?.status === 'developing'
          );
          if (!allEventsVerified) {
            console.log(`[ingest] Skipping alert for ${match.pattern.name}: contains unverified events`);
            continue;
          }
          const prompt = buildStructuredPrompt(match);
          const narrative = await callLLM(prompt, 'narrative');
          await dispatchPatternAlert(match, narrative);
        } catch (err) {
          console.error(`[ingest] Alert dispatch failed:`, err instanceof Error ? err.message : String(err));
        }
      }

      // 3. Update beliefs against new events
      const beliefResult = await evaluateAllBeliefsAgainstNewEvents(verified);
      console.log(`[ingest] Beliefs updated: ${beliefResult.updated}, conflicts: ${beliefResult.conflictsFound}`);

      // 4. Update hypotheses
      const hypoUpdated = await updateAllHypotheses(verified);
      console.log(`[ingest] Hypotheses updated: ${hypoUpdated}`);

      // 5. Check narrative arcs
      const arcResult = await detectAndUpdateNarrativeArcs(verified);
      console.log(`[ingest] Arcs: ${arcResult.advanced} advanced, ${arcResult.created} created`);

      // 6. Anomaly detection
      const anomalies = await detectAnomalies(verified);
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
  const allErrors = adapterResults.flatMap(r => r.errors);
  await finishEngineRun(engineRunId, {
    status: allErrors.length > 0 ? 'partial' : 'success',
    records_in: allEvents.length,
    records_out: totalStored,
    errors: allErrors,
    meta: { elapsed_ms: elapsed },
  });
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

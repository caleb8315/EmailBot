/**
 * Synthesis Composer — merges outputs from all three engines into
 * fused signals with confidence scoring, corroboration, and alert-tier routing.
 *
 * Called by the daily digest workflow to produce one coherent briefing brain.
 */
import { trySharedSupabase } from './shared/supabase';
import { startEngineRun, finishEngineRun } from './shared/engine-run';
import type { AlertTier } from './types';

export interface FusedSignal {
  headline: string;
  summary: string;
  category: string;
  severity: number;
  confidence: number;
  alert_tier: AlertTier;
  source_engines: string[];
  article_ids: string[];
  event_ids: string[];
  corroboration: CorroborationMeta;
  tags: string[];
  country_code?: string;
}

interface CorroborationMeta {
  engine_count: number;
  source_diversity: number;
  has_structured_event: boolean;
  has_news_article: boolean;
  has_pattern_match: boolean;
  contradiction_flags: string[];
  freshness_hours: number;
}

interface ArticleRow {
  id: string;
  title: string;
  source: string;
  summary: string | null;
  importance_score: number | null;
  fetched_at: string;
  url: string;
}

interface EventRow {
  id: string;
  source: string;
  type: string;
  severity: number;
  confidence: number;
  country_code: string | null;
  timestamp: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
}

interface BeliefRow {
  statement: string;
  confidence: number;
  evidence_for: number;
  evidence_against: number;
}

interface HypothesisRow {
  title: string;
  status: string;
  evidence_score: number;
}

interface ArcRow {
  title: string;
  current_act: string;
  significance: number;
}

function hoursAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function computeConfidence(meta: CorroborationMeta): number {
  let score = 0.3;
  if (meta.engine_count >= 2) score += 0.2;
  if (meta.engine_count >= 3) score += 0.1;
  if (meta.source_diversity >= 3) score += 0.1;
  if (meta.has_structured_event && meta.has_news_article) score += 0.15;
  if (meta.has_pattern_match) score += 0.1;
  if (meta.contradiction_flags.length > 0) score -= 0.15;
  if (meta.freshness_hours < 4) score += 0.05;
  return Math.max(0.1, Math.min(1.0, score));
}

function assignTier(severity: number, confidence: number): AlertTier {
  const combined = severity * confidence;
  if (combined >= 75) return 'FLASH';
  if (combined >= 50) return 'PRIORITY';
  if (combined >= 25) return 'DAILY';
  return 'WEEKLY';
}

function clusterByTitle(
  articles: ArticleRow[],
  events: EventRow[]
): { articles: ArticleRow[]; events: EventRow[]; headline: string }[] {
  const clusters: Map<string, { articles: ArticleRow[]; events: EventRow[] }> = new Map();

  for (const a of articles) {
    const key = a.title.toLowerCase().slice(0, 60);
    const existing = clusters.get(key) ?? { articles: [], events: [] };
    existing.articles.push(a);
    clusters.set(key, existing);
  }

  for (const e of events) {
    let matched = false;
    for (const [key, cluster] of clusters) {
      const eTitleLower = e.title.toLowerCase();
      if (
        key.split(' ').filter(w => w.length > 3).some(w => eTitleLower.includes(w))
      ) {
        cluster.events.push(e);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const key = `evt_${e.id}`;
      clusters.set(key, { articles: [], events: [e] });
    }
  }

  return Array.from(clusters.entries()).map(([key, c]) => ({
    ...c,
    headline:
      c.articles[0]?.title ??
      c.events[0]?.title ??
      key,
  }));
}

export async function composeSynthesis(): Promise<FusedSignal[]> {
  const runId = await startEngineRun('digest', { type: 'synthesis' });

  const sb = trySharedSupabase();
  if (!sb) {
    await finishEngineRun(runId, { status: 'error', errors: ['No Supabase connection'] });
    return [];
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [articlesRes, eventsRes, beliefsRes, hyposRes, arcsRes] = await Promise.all([
    sb.from('article_history')
      .select('id,title,source,summary,importance_score,fetched_at,url')
      .gte('fetched_at', cutoff)
      .order('importance_score', { ascending: false })
      .limit(100),
    sb.from('intel_events')
      .select('id,source,type,severity,confidence,country_code,timestamp,title,summary,tags')
      .gte('timestamp', cutoff)
      .order('severity', { ascending: false })
      .limit(200),
    sb.from('beliefs')
      .select('statement,confidence,evidence_for,evidence_against')
      .order('confidence', { ascending: false })
      .limit(20),
    sb.from('hypotheses')
      .select('title,status,evidence_score')
      .in('status', ['active', 'watching'])
      .limit(10),
    sb.from('narrative_arcs')
      .select('title,current_act,significance')
      .order('significance', { ascending: false })
      .limit(10),
  ]);

  const articles: ArticleRow[] = articlesRes.data ?? [];
  const events: EventRow[] = eventsRes.data ?? [];
  const beliefs: BeliefRow[] = beliefsRes.data ?? [];
  const hypotheses: HypothesisRow[] = hyposRes.data ?? [];
  const arcs: ArcRow[] = arcsRes.data ?? [];

  const clusters = clusterByTitle(articles, events);
  const signals: FusedSignal[] = [];

  for (const cluster of clusters) {
    const engines: string[] = [];
    if (cluster.articles.length > 0) engines.push('news_pipeline');
    if (cluster.events.length > 0) engines.push('world_ingest');

    const topArticle = cluster.articles[0];
    const topEvent = cluster.events[0];

    const uniqueSources = new Set([
      ...cluster.articles.map(a => a.source),
      ...cluster.events.map(e => e.source),
    ]);

    const freshestIso =
      topArticle?.fetched_at ?? topEvent?.timestamp ?? new Date().toISOString();

    const hasPattern = cluster.events.some(
      e => e.tags?.includes('pattern_match') || e.tags?.includes('critical')
    );

    const corroboration: CorroborationMeta = {
      engine_count: engines.length,
      source_diversity: uniqueSources.size,
      has_structured_event: cluster.events.length > 0,
      has_news_article: cluster.articles.length > 0,
      has_pattern_match: hasPattern,
      contradiction_flags: [],
      freshness_hours: hoursAgo(freshestIso),
    };

    const severity = Math.max(
      topArticle?.importance_score ?? 0,
      topEvent?.severity ?? 0
    );

    const confidence = computeConfidence(corroboration);
    const tier = assignTier(severity, confidence);

    signals.push({
      headline: cluster.headline,
      summary: topArticle?.summary ?? topEvent?.summary ?? '',
      category: topEvent?.type ?? 'news',
      severity,
      confidence,
      alert_tier: tier,
      source_engines: engines,
      article_ids: cluster.articles.map(a => a.id),
      event_ids: cluster.events.map(e => e.id),
      corroboration,
      tags: [
        ...new Set([
          ...cluster.events.flatMap(e => e.tags ?? []),
        ]),
      ],
      country_code: topEvent?.country_code ?? undefined,
    });
  }

  signals.sort((a, b) => {
    const aScore = a.severity * a.confidence;
    const bScore = b.severity * b.confidence;
    return bScore - aScore;
  });

  const topSignals = signals.slice(0, 50);

  try {
    const rows = topSignals.map(s => ({
      headline: s.headline.slice(0, 500),
      summary: (s.summary ?? '').slice(0, 2000),
      category: s.category,
      severity: s.severity,
      confidence: s.confidence,
      alert_tier: s.alert_tier,
      source_engines: s.source_engines,
      article_ids: s.article_ids,
      event_ids: s.event_ids,
      corroboration: s.corroboration,
      tags: s.tags,
      country_code: s.country_code ?? null,
    }));

    if (rows.length > 0) {
      const { error } = await sb.from('fused_signals').insert(rows);
      if (error) console.error('[synthesis] Store error:', error.message);
    }
  } catch (err) {
    console.error('[synthesis] Store failed:', err instanceof Error ? err.message : String(err));
  }

  await finishEngineRun(runId, {
    status: 'success',
    records_in: articles.length + events.length,
    records_out: topSignals.length,
    meta: {
      beliefs_count: beliefs.length,
      hypotheses_active: hypotheses.length,
      arcs_active: arcs.length,
    },
  });

  console.log(
    `[synthesis] Composed ${topSignals.length} fused signals from ${articles.length} articles + ${events.length} events`
  );
  return topSignals;
}

export function formatSynthesisDigestSection(signals: FusedSignal[]): string {
  if (signals.length === 0) return '';

  const flash = signals.filter(s => s.alert_tier === 'FLASH');
  const priority = signals.filter(s => s.alert_tier === 'PRIORITY');
  const daily = signals.filter(s => s.alert_tier === 'DAILY').slice(0, 10);

  const lines: string[] = [];

  if (flash.length > 0) {
    lines.push('=== FLASH SIGNALS ===');
    for (const s of flash) {
      lines.push(`[${s.severity}/${Math.round(s.confidence * 100)}%] ${s.headline}`);
      if (s.summary) lines.push(`  ${s.summary.slice(0, 200)}`);
      lines.push(`  Engines: ${s.source_engines.join(', ')} | Sources: ${s.corroboration.source_diversity}`);
      lines.push('');
    }
  }

  if (priority.length > 0) {
    lines.push('=== PRIORITY SIGNALS ===');
    for (const s of priority.slice(0, 8)) {
      lines.push(`[${s.severity}/${Math.round(s.confidence * 100)}%] ${s.headline}`);
      if (s.summary) lines.push(`  ${s.summary.slice(0, 150)}`);
      lines.push('');
    }
  }

  if (daily.length > 0) {
    lines.push('=== DAILY WATCH ===');
    for (const s of daily) {
      lines.push(`- ${s.headline}`);
    }
  }

  return lines.join('\n');
}

import type { IntelEvent } from './types';

export interface NarrativeCluster {
  articles: { title: string; source: string; timestamp: string }[];
  unique_sources: number;
  time_spread_minutes: number;
  fringe_first: boolean;
  narrative_summary: string;
  significance: number;
}

// ── TF-IDF based narrative clustering ───────────────────────────────────
// No ML/external libs needed. Pure keyword frequency analysis.

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

function buildTFIDF(documents: string[]): Map<string, number[]> {
  const tf: Map<string, number[]> = new Map();
  const df: Map<string, number> = new Map();

  for (let i = 0; i < documents.length; i++) {
    const tokens = tokenize(documents[i]);
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);

    const seen = new Set<string>();
    for (const [word, count] of counts) {
      if (!tf.has(word)) tf.set(word, new Array(documents.length).fill(0));
      tf.get(word)![i] = count / tokens.length;
      if (!seen.has(word)) {
        df.set(word, (df.get(word) || 0) + 1);
        seen.add(word);
      }
    }
  }

  // Apply IDF
  const n = documents.length;
  for (const [word, freqs] of tf) {
    const idf = Math.log(n / (df.get(word) || 1));
    for (let i = 0; i < freqs.length; i++) {
      freqs[i] *= idf;
    }
  }

  return tf;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function getDocumentVector(tf: Map<string, number[]>, docIdx: number): number[] {
  const vec: number[] = [];
  for (const freqs of tf.values()) {
    vec.push(freqs[docIdx]);
  }
  return vec;
}

// ── Detect coordinated narrative clusters ───────────────────────────────

export function detectNarrativeClusters(
  events: IntelEvent[],
  timeWindowHours: number = 12,
  similarityThreshold: number = 0.75,
): NarrativeCluster[] {
  const cutoff = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);
  const recent = events.filter(e => new Date(e.timestamp) > cutoff && e.type === 'news_signal');

  if (recent.length < 3) return [];

  const documents = recent.map(e => `${e.title} ${e.summary}`);
  const tf = buildTFIDF(documents);

  // Build similarity matrix and cluster
  const clusters: number[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < recent.length; i++) {
    if (assigned.has(i)) continue;

    const cluster = [i];
    assigned.add(i);
    const vecI = getDocumentVector(tf, i);

    for (let j = i + 1; j < recent.length; j++) {
      if (assigned.has(j)) continue;
      const vecJ = getDocumentVector(tf, j);
      if (cosineSimilarity(vecI, vecJ) >= similarityThreshold) {
        cluster.push(j);
        assigned.add(j);
      }
    }

    if (cluster.length >= 3) clusters.push(cluster);
  }

  // Convert to NarrativeCluster objects
  return clusters
    .map(indices => {
      const articles = indices.map(i => ({
        title: recent[i].title,
        source: (recent[i].raw_data as Record<string, string>)?.source_name || recent[i].source,
        timestamp: recent[i].timestamp,
      }));

      const sources = new Set(articles.map(a => a.source));
      const timestamps = articles.map(a => new Date(a.timestamp).getTime());
      const timeSpreadMs = Math.max(...timestamps) - Math.min(...timestamps);

      // Check fringe-first: did non-mainstream sources publish before mainstream?
      const mainstreams = ['Reuters', 'AP', 'BBC', 'CNN', 'NYT'];
      const fringeArticles = articles.filter(a => !mainstreams.some(m => a.source.includes(m)));
      const mainstreamArticles = articles.filter(a => mainstreams.some(m => a.source.includes(m)));

      const fringeFirst =
        fringeArticles.length > 0 &&
        mainstreamArticles.length > 0 &&
        Math.min(...fringeArticles.map(a => new Date(a.timestamp).getTime())) <
        Math.min(...mainstreamArticles.map(a => new Date(a.timestamp).getTime()));

      // Extract common words for summary
      const allTokens = articles.flatMap(a => tokenize(a.title));
      const wordCounts = new Map<string, number>();
      for (const w of allTokens) wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
      const topWords = [...wordCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([w]) => w);

      return {
        articles,
        unique_sources: sources.size,
        time_spread_minutes: timeSpreadMs / (1000 * 60),
        fringe_first: fringeFirst,
        narrative_summary: `Coordinated narrative: "${topWords.join(', ')}" across ${sources.size} sources`,
        significance: Math.min(100, sources.size * 15 + (fringeFirst ? 20 : 0)),
      };
    })
    .filter(c => c.unique_sources >= 3 && c.time_spread_minutes < 120);
}

/**
 * Convert detected narrative clusters into `narrative_cluster` IntelEvents
 * so that the rules engine can fire `io_campaign_detected` and the belief
 * / hypothesis engines can see them. Until this wiring existed, the IO
 * detector was effectively dead code: the rules engine listed
 * `narrative_cluster` as a signal type that no producer ever emitted.
 */
export function narrativeClustersToEvents(
  clusters: NarrativeCluster[],
  opts: { country_code?: string } = {},
): IntelEvent[] {
  const now = new Date().toISOString();
  return clusters.map((c) => ({
    source: 'rss',
    type: 'narrative_cluster',
    severity: Math.min(100, Math.max(20, c.significance)),
    confidence: c.fringe_first ? 0.7 : 0.55,
    lat: 0,
    lng: 0,
    country_code: opts.country_code || 'XX',
    timestamp: now,
    title: c.narrative_summary.slice(0, 240),
    summary: `${c.unique_sources} distinct sources within ${Math.round(c.time_spread_minutes)} min${c.fringe_first ? ' — fringe-first amplification detected' : ''}`,
    raw_data: {
      articles: c.articles.slice(0, 12),
      unique_sources: c.unique_sources,
      time_spread_minutes: c.time_spread_minutes,
      fringe_first: c.fringe_first,
    },
    tags: ['narrative_cluster', ...(c.fringe_first ? ['fringe_first'] : [])],
  }));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from',
  'that', 'this', 'with', 'they', 'will', 'said', 'would', 'about',
  'could', 'than', 'them', 'into', 'more', 'also', 'over', 'after',
  'what', 'when', 'which', 'their', 'there', 'other', 'some', 'just',
  'being', 'between', 'those', 'through', 'while', 'where', 'still',
  'news', 'report', 'reports', 'according', 'says', 'reuters', 'press',
]);

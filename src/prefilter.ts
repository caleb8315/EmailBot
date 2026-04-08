import { createLogger } from "./logger";
import type { RawArticle, FilteredArticle, UserPreferences } from "./types";

const logger = createLogger("prefilter");

const PREFILTER_THRESHOLD = parseInt(
  process.env.PREFILTER_THRESHOLD ?? "40",
  10
);

// ── Tiered urgency keywords ─────────────────────────────────────
// Tier 1: Existential / crisis-level events (immediate Telegram alert territory)
const TIER1_KEYWORDS = [
  "war declared",
  "declares war",
  "nuclear",
  "assassination",
  "assassinated",
  "earthquake",
  "tsunami",
  "pandemic",
  "coup",
  "martial law",
  "terrorist attack",
  "mass shooting",
  "plane crash",
  "market crash",
  "stock market crash",
  "bank collapse",
  "invasion",
  "missile strike",
  "state of emergency",
  "killed in",
  "deaths reported",
  "explosion",
];

// Tier 2: High-importance events
const TIER2_KEYWORDS = [
  "breaking",
  "breaking news",
  "emergency",
  "sanctions",
  "indictment",
  "indicted",
  "recession",
  "impeach",
  "resign",
  "arrest",
  "arrested",
  "breach",
  "hack",
  "hacked",
  "recall",
  "ban",
  "banned",
  "shutdown",
  "shuts down",
  "ceasefire",
  "peace deal",
  "hostage",
  "evacuation",
  "collapse",
  "default",
  "inflation",
];

// Tier 3: Noteworthy but routine business/tech events
const TIER3_KEYWORDS = [
  "announces",
  "launches",
  "raises",
  "acquires",
  "acquisition",
  "ipo",
  "merger",
  "regulation",
  "ruling",
  "verdict",
  "elected",
  "appointed",
  "fired",
  "layoffs",
  "partnership",
];

const NOISE_KEYWORDS = [
  "sponsored",
  "quiz",
  "listicle",
  "click",
  "you won't believe",
  "subscribe now",
  "limited time",
  "giveaway",
  "horoscope",
];

// ── Helpers ─────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

export function computeTitleSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    a.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  );
  const wordsB = new Set(
    b.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  );
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 0;
  return (intersection.length / union.size) * 100;
}

function matchesAny(text: string, keywords: string[]): string[] {
  return keywords.filter((kw) => text.includes(kw));
}

function hoursAgo(isoDate: string): number {
  try {
    return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
  } catch {
    return 999;
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── Heuristic importance (1-10) ─────────────────────────────────

interface ImportanceFactors {
  base: number;
  tier1Bonus: number;
  tier2Bonus: number;
  tier3Bonus: number;
  corroborationBonus: number;
  interestBonus: number;
  tier1KeywordBonus: number;
  recencyBonus: number;
  lengthBonus: number;
  noisePenalty: number;
  dislikePenalty: number;
}

function computeHeuristicImportance(
  article: RawArticle,
  prefs: UserPreferences,
  corroborationCount: number
): { score: number; factors: ImportanceFactors } {
  const titleLower = article.title.toLowerCase();
  const textLower = `${titleLower} ${article.content.toLowerCase()}`;

  let base = 4;
  const tier1Hits = matchesAny(textLower, TIER1_KEYWORDS);
  const tier2Hits = matchesAny(textLower, TIER2_KEYWORDS);
  const tier3Hits = matchesAny(textLower, TIER3_KEYWORDS);

  const tier1Bonus = tier1Hits.length > 0 ? 3 + Math.min(tier1Hits.length - 1, 2) : 0;
  const tier2Bonus = tier2Hits.length > 0 ? 2 + Math.min(tier2Hits.length - 1, 1) : 0;
  const tier3Bonus = tier3Hits.length > 0 ? 1 : 0;

  // Cross-source corroboration
  let corroborationBonus = 0;
  if (corroborationCount >= 4) corroborationBonus = 3;
  else if (corroborationCount >= 3) corroborationBonus = 2;
  else if (corroborationCount >= 2) corroborationBonus = 1;

  // User interests from prefs
  const interestBonus = prefs.interests.some(
    (i) => textLower.includes(i.toLowerCase())
  ) ? 1 : 0;

  // Briefing overlay tier1_keywords (personal "always alert me" triggers)
  const overlayKw = prefs.briefing_overlay?.tier1_keywords ?? [];
  const tier1KeywordBonus = overlayKw.some(
    (kw) => textLower.includes(kw.toLowerCase())
  ) ? 2 : 0;

  // Recency: fresh = boost
  const age = hoursAgo(article.publishedAt);
  const recencyBonus = age < 1 ? 1 : age < 3 ? 0.5 : 0;

  // Substantive content
  const lengthBonus = article.wordCount > 500 ? 0.5 : 0;

  // Noise deduction
  const noiseHits = matchesAny(titleLower, NOISE_KEYWORDS);
  const noisePenalty = noiseHits.length > 0 ? 2 : 0;

  const dislikePenalty = prefs.dislikes.some(
    (d) => textLower.includes(d.toLowerCase())
  ) ? 1.5 : 0;

  const raw =
    base +
    tier1Bonus +
    tier2Bonus +
    tier3Bonus +
    corroborationBonus +
    interestBonus +
    tier1KeywordBonus +
    recencyBonus +
    lengthBonus -
    noisePenalty -
    dislikePenalty;

  return {
    score: clamp(Math.round(raw * 10) / 10, 1, 10),
    factors: {
      base,
      tier1Bonus,
      tier2Bonus,
      tier3Bonus,
      corroborationBonus,
      interestBonus,
      tier1KeywordBonus,
      recencyBonus,
      lengthBonus,
      noisePenalty,
      dislikePenalty,
    },
  };
}

// ── Heuristic credibility (1-10) ────────────────────────────────

function computeHeuristicCredibility(
  article: RawArticle,
  prefs: UserPreferences,
  corroborationCount: number
): number {
  const trustScore = article.sourceTrustScore ?? 5;
  const domain = extractDomain(article.url);

  let cred = trustScore;

  if (
    prefs.trusted_sources.some(
      (s) =>
        domain.includes(s.toLowerCase()) ||
        article.source.toLowerCase().includes(s.toLowerCase())
    )
  ) {
    cred += 1;
  }

  if (
    prefs.blocked_sources.some(
      (s) =>
        domain.includes(s.toLowerCase()) ||
        article.source.toLowerCase().includes(s.toLowerCase())
    )
  ) {
    cred -= 3;
  }

  if (corroborationCount >= 3) cred += 1;
  if (corroborationCount >= 5) cred += 1;

  const noiseHits = matchesAny(article.title.toLowerCase(), NOISE_KEYWORDS);
  if (noiseHits.length > 0) cred -= 1;

  return clamp(Math.round(cred * 10) / 10, 1, 10);
}

// ── Legacy prefilter score (0-100, for passedPrefilter gate) ────

function computePrefilterScore(
  article: RawArticle,
  prefs: UserPreferences,
  seenUrls: Set<string>,
  seenTitles: string[]
): number {
  let score = 50;
  const domain = extractDomain(article.url);
  const titleLower = article.title.toLowerCase();
  const contentLower = article.content.toLowerCase();

  if (
    prefs.trusted_sources.some(
      (s) =>
        domain.includes(s.toLowerCase()) ||
        article.source.toLowerCase().includes(s.toLowerCase())
    )
  ) {
    score += 20;
  }

  const allSignal = [...TIER1_KEYWORDS, ...TIER2_KEYWORDS, ...TIER3_KEYWORDS];
  const matched = matchesAny(titleLower, allSignal).length +
    matchesAny(contentLower, allSignal).length;
  if (matched > 0) score += 15;

  if (article.wordCount > 300) score += 10;

  if (
    prefs.blocked_sources.some(
      (s) =>
        domain.includes(s.toLowerCase()) ||
        article.source.toLowerCase().includes(s.toLowerCase())
    )
  ) {
    score -= 30;
  }

  const noiseHits = matchesAny(titleLower, NOISE_KEYWORDS);
  if (noiseHits.length > 0) score -= 20;

  if (seenUrls.has(article.url)) {
    score -= 15;
  } else {
    const isDuplicate = seenTitles.some(
      (t) => computeTitleSimilarity(article.title, t) > 85
    );
    if (isDuplicate) score -= 15;
  }

  if (prefs.interests.length > 0) {
    const hit = prefs.interests.some(
      (i) =>
        titleLower.includes(i.toLowerCase()) ||
        contentLower.includes(i.toLowerCase())
    );
    if (hit) score += 10;
  }

  if (prefs.dislikes.length > 0) {
    const hit = prefs.dislikes.some(
      (d) =>
        titleLower.includes(d.toLowerCase()) ||
        contentLower.includes(d.toLowerCase())
    );
    if (hit) score -= 15;
  }

  return clamp(score, 0, 100);
}

// ── Cross-source corroboration ──────────────────────────────────

interface CorroborationMap {
  [normalizedTitle: string]: { sources: Set<string>; indices: number[] };
}

function buildCorroborationMap(articles: RawArticle[]): CorroborationMap {
  const groups: CorroborationMap = {};
  const assigned: number[] = new Array(articles.length).fill(-1);

  for (let i = 0; i < articles.length; i++) {
    if (assigned[i] >= 0) continue;

    const groupKey = articles[i].title;
    groups[groupKey] = {
      sources: new Set([articles[i].source]),
      indices: [i],
    };
    assigned[i] = i;

    for (let j = i + 1; j < articles.length; j++) {
      if (assigned[j] >= 0) continue;
      if (computeTitleSimilarity(articles[i].title, articles[j].title) > 55) {
        groups[groupKey].sources.add(articles[j].source);
        groups[groupKey].indices.push(j);
        assigned[j] = i;
      }
    }
  }

  return groups;
}

function getCorroborationCount(
  articleIndex: number,
  corrobMap: CorroborationMap
): number {
  for (const group of Object.values(corrobMap)) {
    if (group.indices.includes(articleIndex)) {
      return group.sources.size;
    }
  }
  return 1;
}

// ── Main export ─────────────────────────────────────────────────

export function prefilterArticles(
  articles: RawArticle[],
  prefs: UserPreferences,
  existingUrls: Set<string> = new Set()
): FilteredArticle[] {
  const seenTitles: string[] = [];
  const results: FilteredArticle[] = [];

  const corrobMap = buildCorroborationMap(articles);

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    try {
      const prefilterScore = computePrefilterScore(
        article,
        prefs,
        existingUrls,
        seenTitles
      );
      const passedPrefilter = prefilterScore >= PREFILTER_THRESHOLD;

      const corroborationCount = getCorroborationCount(i, corrobMap);

      const { score: heuristicImportance, factors } =
        computeHeuristicImportance(article, prefs, corroborationCount);
      const heuristicCredibility = computeHeuristicCredibility(
        article,
        prefs,
        corroborationCount
      );

      results.push({
        ...article,
        prefilterScore,
        passedPrefilter,
        heuristicImportance,
        heuristicCredibility,
        corroborationCount,
      });

      seenTitles.push(article.title);

      logger.debug("Prefilter scored", {
        title: article.title.slice(0, 80),
        prefilter: prefilterScore,
        importance: heuristicImportance,
        credibility: heuristicCredibility,
        corroboration: corroborationCount,
        factors: factors.tier1Bonus > 0 || factors.tier2Bonus > 0
          ? factors
          : undefined,
      });
    } catch (err) {
      logger.error("Prefilter failed for article", {
        title: article.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passed = results.filter((a) => a.passedPrefilter).length;
  const highImportance = results.filter(
    (a) => a.heuristicImportance >= 8
  ).length;
  logger.info("Prefilter complete", {
    total: articles.length,
    passed,
    filtered: articles.length - passed,
    threshold: PREFILTER_THRESHOLD,
    highImportanceArticles: highImportance,
  });

  return results;
}

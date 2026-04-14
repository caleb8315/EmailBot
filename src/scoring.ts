import { createLogger } from "./logger";
import type { ArticleHistory, UserPreferences } from "./types";
import {
  extractCanonicalDomain,
  isDomainMatch,
  isDomainBlocked,
} from "../lib/verification";

const logger = createLogger("scoring");

export interface ScoredArticle extends ArticleHistory {
  compositeScore: number;
}

export interface BalancedDigestSelectionMeta {
  totalInput: number;
  selectedCount: number;
  mustKnowCount: number;
  personalCount: number;
  sourceDiversity: number;
  interestMatchedCount: number;
  blockedSourceSkipped: number;
}

export interface BalancedDigestSelection {
  selected: ScoredArticle[];
  meta: BalancedDigestSelectionMeta;
}

/**
 * Weighted composite: importance (40%), relevance (35%), credibility (25%).
 * When relevance is absent (heuristic-only mode), uses importance (55%) + credibility (45%).
 */
function computeComposite(article: ArticleHistory): number {
  if (
    article.importance_score !== null &&
    article.relevance_score !== null &&
    article.credibility_score !== null
  ) {
    return (
      article.importance_score * 0.4 +
      article.relevance_score * 0.35 +
      article.credibility_score * 0.25
    );
  }

  if (article.importance_score !== null && article.credibility_score !== null) {
    return (
      article.importance_score * 0.55 +
      article.credibility_score * 0.45
    );
  }

  let fallback = 3;
  if (article.title.length > 40) fallback += 0.5;
  if (article.summary && article.summary.length > 50) fallback += 1;
  if (article.source) fallback += 0.5;
  return Math.min(fallback, 5);
}

export function rankArticles(articles: ArticleHistory[]): ScoredArticle[] {
  const scored: ScoredArticle[] = articles.map((a) => ({
    ...a,
    compositeScore: computeComposite(a),
  }));

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  logger.debug("Articles ranked", {
    total: scored.length,
    topScore: scored[0]?.compositeScore ?? 0,
  });

  return scored;
}

export function getTopArticles(
  articles: ArticleHistory[],
  count: number
): ScoredArticle[] {
  return rankArticles(articles).slice(0, count);
}

function normalizeTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.toLowerCase().trim();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function countTermMatches(text: string, terms: string[]): number {
  let matches = 0;
  for (const term of terms) {
    if (text.includes(term)) matches += 1;
  }
  return matches;
}

function includesSourceHint(
  source: string,
  url: string,
  hints: string[]
): boolean {
  const domain = extractCanonicalDomain(url);
  return hints.some((hint) => isDomainMatch(domain, hint));
}

function recencyScore(fetchedAtIso: string): number {
  const fetchedAtMs = Date.parse(fetchedAtIso);
  if (!Number.isFinite(fetchedAtMs)) return 0.25;
  const ageHours = Math.max(0, (Date.now() - fetchedAtMs) / 3_600_000);
  // Smooth decay: fresh items get some lift, but quality still dominates.
  return 1 / (1 + ageHours / 18);
}

interface DigestCandidate extends ScoredArticle {
  mustKnowScore: number;
  personalScore: number;
  sourceKey: string;
  interestHits: number;
  blockedSource: boolean;
}

export function selectBalancedDigestArticles(
  articles: ArticleHistory[],
  preferences: Partial<UserPreferences> | null | undefined,
  count: number,
  mustKnowRatio = 0.6
): BalancedDigestSelection {
  if (count <= 0 || articles.length === 0) {
    return {
      selected: [],
      meta: {
        totalInput: articles.length,
        selectedCount: 0,
        mustKnowCount: 0,
        personalCount: 0,
        sourceDiversity: 0,
        interestMatchedCount: 0,
        blockedSourceSkipped: 0,
      },
    };
  }

  const overlay = (preferences?.briefing_overlay ?? {}) as NonNullable<
    UserPreferences["briefing_overlay"]
  >;
  const interests = normalizeTerms([
    ...(preferences?.interests ?? []),
    ...(overlay.tier1_keywords ?? []),
  ]);
  const dislikes = normalizeTerms(preferences?.dislikes ?? []);
  const boostedHints = normalizeTerms(overlay.boost_categories ?? []);
  const ignoredHints = normalizeTerms(overlay.ignore_categories ?? []);
  const trustedSources = normalizeTerms(preferences?.trusted_sources ?? []);
  const blockedSources = normalizeTerms([
    ...(preferences?.blocked_sources ?? []),
    ...(overlay.ignore_sources ?? []),
  ]);

  const ranked = rankArticles(articles);
  const candidates: DigestCandidate[] = ranked.map((article) => {
    const text = `${article.title} ${article.summary ?? ""}`.toLowerCase();
    const sourceKey = article.source.trim().toLowerCase();
    const interestHits = countTermMatches(text, interests);
    const dislikeHits = countTermMatches(text, dislikes);
    const boostHits = countTermMatches(text, boostedHints);
    const ignoreHits = countTermMatches(text, ignoredHints);
    const trustedSource = includesSourceHint(
      article.source,
      article.url,
      trustedSources
    );
    const blockedSource = includesSourceHint(
      article.source,
      article.url,
      blockedSources
    );
    const recency = recencyScore(article.fetched_at);
    const importance = article.importance_score ?? article.compositeScore;
    const credibility = article.credibility_score ?? 5;

    const mustKnowScore =
      article.compositeScore * 1.05 +
      importance * 0.2 +
      credibility * 0.2 +
      recency * 1.2 +
      (importance >= 8 ? 1 : 0) +
      (credibility >= 8 ? 0.6 : 0) -
      (blockedSource ? 1.4 : 0);

    const personalScore =
      mustKnowScore +
      interestHits * 1.4 +
      boostHits * 0.9 +
      (trustedSource ? 0.8 : 0) -
      dislikeHits * 1.5 -
      ignoreHits * 1.2 -
      (blockedSource ? 2.0 : 0);

    return {
      ...article,
      sourceKey,
      interestHits,
      blockedSource,
      mustKnowScore,
      personalScore,
    };
  });

  const mustKnowTarget = Math.min(
    count,
    Math.max(1, Math.round(count * mustKnowRatio))
  );
  const personalTarget = Math.max(0, count - mustKnowTarget);
  const maxPerSource = Math.max(2, Math.round(count * 0.2));
  const selected: DigestCandidate[] = [];
  const seenUrls = new Set<string>();
  const sourceCounts = new Map<string, number>();
  let blockedSourceSkipped = 0;
  let mustKnowCount = 0;
  let personalCount = 0;

  const trySelect = (
    candidate: DigestCandidate,
    lane: "must" | "personal",
    allowBlocked = false
  ): boolean => {
    if (seenUrls.has(candidate.url)) return false;
    if (candidate.blockedSource && !allowBlocked) {
      blockedSourceSkipped += 1;
      return false;
    }
    const usedFromSource = sourceCounts.get(candidate.sourceKey) ?? 0;
    if (usedFromSource >= maxPerSource) return false;

    seenUrls.add(candidate.url);
    sourceCounts.set(candidate.sourceKey, usedFromSource + 1);
    selected.push(candidate);
    if (lane === "must") mustKnowCount += 1;
    else personalCount += 1;
    return true;
  };

  const mustSorted = [...candidates].sort(
    (a, b) => b.mustKnowScore - a.mustKnowScore
  );
  for (const candidate of mustSorted) {
    if (mustKnowCount >= mustKnowTarget) break;
    const allowBlocked = candidate.mustKnowScore >= 11;
    trySelect(candidate, "must", allowBlocked);
  }

  const personalSorted = [...candidates].sort(
    (a, b) => b.personalScore - a.personalScore
  );
  for (const candidate of personalSorted) {
    if (personalCount >= personalTarget) break;
    if (selected.length >= count) break;
    if (candidate.interestHits === 0 && candidate.personalScore < candidate.mustKnowScore) {
      continue;
    }
    trySelect(candidate, "personal");
  }

  for (const candidate of mustSorted) {
    if (selected.length >= count) break;
    const allowBlocked = candidate.mustKnowScore >= 11;
    trySelect(candidate, "must", allowBlocked);
  }

  const final = selected
    .sort(
      (a, b) =>
        Math.max(b.mustKnowScore, b.personalScore) -
        Math.max(a.mustKnowScore, a.personalScore)
    )
    .slice(0, count);

  const interestMatchedCount = final.filter((a) => a.interestHits > 0).length;
  const sourceDiversity = new Set(final.map((a) => a.sourceKey)).size;

  logger.debug("Balanced digest selection complete", {
    input: articles.length,
    selected: final.length,
    mustKnowCount,
    personalCount,
    sourceDiversity,
    interestMatchedCount,
    blockedSourceSkipped,
  });

  return {
    selected: final,
    meta: {
      totalInput: articles.length,
      selectedCount: final.length,
      mustKnowCount,
      personalCount,
      sourceDiversity,
      interestMatchedCount,
      blockedSourceSkipped,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Sensitivity scale:
 * 1 = strictest (only extreme, highly credible events)
 * 10 = most permissive (still important, but wider net)
 */
export function getAlertThresholds(
  alertSensitivity: number = 5
): { importance: number; credibility: number } {
  const sensitivity = clamp(Math.round(alertSensitivity), 1, 10);
  // Linear mapping keeps behavior intuitive and bounded.
  // sensitivity 1  -> importance 10.0 / credibility 8.0
  // sensitivity 10 -> importance 8.0  / credibility 6.0
  const importance = Number((10 - ((sensitivity - 1) * 2) / 9).toFixed(1));
  const credibility = Number((8 - ((sensitivity - 1) * 2) / 9).toFixed(1));
  return { importance, credibility };
}

export function shouldAlert(
  article: ArticleHistory,
  alertSensitivity: number = 5
): boolean {
  // Hard gate: never alert quarantined or blocked articles
  if (article.verification_status === 'quarantined'
      || article.verification_status === 'blocked') {
    return false;
  }

  const thresholds = getAlertThresholds(alertSensitivity);
  const meetsImportance =
    article.importance_score !== null &&
    article.importance_score >= thresholds.importance;
  const meetsCredibility =
    article.credibility_score !== null &&
    article.credibility_score >= thresholds.credibility;

  // For unverified articles, require even higher thresholds
  if (!article.verification_status || article.verification_status === 'unverified') {
    const stricterImportance = (thresholds.importance + 10) / 2;
    const stricterCredibility = (thresholds.credibility + 10) / 2;
    return (article.importance_score ?? 0) >= stricterImportance
        && (article.credibility_score ?? 0) >= stricterCredibility;
  }

  return meetsImportance && meetsCredibility;
}

export function extractEmergingTopics(
  articles: ArticleHistory[]
): Map<string, number> {
  const topicCounts = new Map<string, number>();

  for (const article of articles) {
    if (!article.summary) continue;

    const words = article.summary
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);

    for (const word of words) {
      topicCounts.set(word, (topicCounts.get(word) ?? 0) + 1);
    }
  }

  const sorted = new Map(
    [...topicCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
  );

  return sorted;
}

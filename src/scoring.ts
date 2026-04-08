import { createLogger } from "./logger";
import type { ArticleHistory } from "./types";

const logger = createLogger("scoring");

export interface ScoredArticle extends ArticleHistory {
  compositeScore: number;
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

export function shouldAlert(article: ArticleHistory): boolean {
  const meetsImportance =
    article.importance_score !== null && article.importance_score >= 8;
  const meetsCredibility =
    article.credibility_score !== null && article.credibility_score >= 6;
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

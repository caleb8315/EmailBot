import { createLogger } from "./logger";
import type { RawArticle, FilteredArticle, UserPreferences } from "./types";

const logger = createLogger("prefilter");

const PREFILTER_THRESHOLD = parseInt(
  process.env.PREFILTER_THRESHOLD ?? "40",
  10
);

const HIGH_SIGNAL_KEYWORDS = [
  "breaking",
  "announces",
  "launches",
  "raises",
  "acquires",
  "shuts down",
  "recall",
  "breach",
  "regulation",
  "ban",
  "arrest",
];

const NOISE_KEYWORDS = [
  "sponsored",
  "partner",
  "quiz",
  "listicle",
  "click",
  "you won't believe",
];

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

function computeTitleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 0;
  return (intersection.length / union.size) * 100;
}

function scoreArticle(
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
      (s) => domain.includes(s.toLowerCase()) || article.source.toLowerCase().includes(s.toLowerCase())
    )
  ) {
    score += 20;
  }

  const matchedSignal = HIGH_SIGNAL_KEYWORDS.filter(
    (kw) => titleLower.includes(kw) || contentLower.includes(kw)
  );
  if (matchedSignal.length > 0) {
    score += 15;
  }

  if (article.wordCount > 300) {
    score += 10;
  }

  if (
    prefs.blocked_sources.some(
      (s) => domain.includes(s.toLowerCase()) || article.source.toLowerCase().includes(s.toLowerCase())
    )
  ) {
    score -= 30;
  }

  const matchedNoise = NOISE_KEYWORDS.filter((kw) => titleLower.includes(kw));
  if (matchedNoise.length > 0) {
    score -= 20;
  }

  if (seenUrls.has(article.url)) {
    score -= 15;
  } else {
    const isDuplicate = seenTitles.some(
      (t) => computeTitleSimilarity(article.title, t) > 85
    );
    if (isDuplicate) {
      score -= 15;
    }
  }

  if (prefs.interests.length > 0) {
    const interestMatch = prefs.interests.some(
      (interest) =>
        titleLower.includes(interest.toLowerCase()) ||
        contentLower.includes(interest.toLowerCase())
    );
    if (interestMatch) score += 10;
  }

  if (prefs.dislikes.length > 0) {
    const dislikeMatch = prefs.dislikes.some(
      (dislike) =>
        titleLower.includes(dislike.toLowerCase()) ||
        contentLower.includes(dislike.toLowerCase())
    );
    if (dislikeMatch) score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

export function prefilterArticles(
  articles: RawArticle[],
  prefs: UserPreferences,
  existingUrls: Set<string> = new Set()
): FilteredArticle[] {
  const seenTitles: string[] = [];
  const results: FilteredArticle[] = [];

  for (const article of articles) {
    try {
      const prefilterScore = scoreArticle(
        article,
        prefs,
        existingUrls,
        seenTitles
      );
      const passedPrefilter = prefilterScore >= PREFILTER_THRESHOLD;

      results.push({
        ...article,
        prefilterScore,
        passedPrefilter,
      });

      seenTitles.push(article.title);

      logger.debug("Prefilter scored", {
        title: article.title.slice(0, 80),
        score: prefilterScore,
        passed: passedPrefilter,
      });
    } catch (err) {
      logger.error("Prefilter failed for article", {
        title: article.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passed = results.filter((a) => a.passedPrefilter).length;
  logger.info("Prefilter complete", {
    total: articles.length,
    passed,
    filtered: articles.length - passed,
    threshold: PREFILTER_THRESHOLD,
  });

  return results;
}

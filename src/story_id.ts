/**
 * Story identity helpers for alert deduplication.
 *
 * Problem: outlets like The Guardian and BBC mint a fresh URL for their
 * running "live blog" stories every day (and often rewrite the slug mid-day
 * as the story evolves). URL-based dedup is defeated, so the same ongoing
 * Middle East / markets / weather story alerts the user every pipeline run.
 *
 * Solution: derive a stable "story signature" from the title (and URL shape)
 * and dedup alerts against *that* instead of — or in addition to — the URL.
 */

/** Path-level heuristics for live-blog URLs used by Guardian, BBC, AP, etc. */
const LIVE_PATH_PATTERNS: RegExp[] = [
  /\/live\//,
  /\/live-/,
  /\/live$/,
  /\/liveblog\//,
  /\/live-updates\//,
];

/** Title-level heuristics — "Middle East crisis live: …", "Live blog: …". */
const LIVE_TITLE_PATTERNS: RegExp[] = [
  /\blive\s*:/i,
  /\blive\s+blog\b/i,
  /\blive\s+updates?\b/i,
  /\bas\s+it\s+happen(?:s|ed)\b/i,
];

/** Stopwords stripped when building a stable signature. */
const STOPWORDS = new Set([
  "the", "and", "but", "for", "with", "from", "into", "over", "under",
  "after", "before", "about", "amid", "says", "said", "has", "had",
  "will", "wont", "during", "through", "against", "between", "not",
  "new", "latest", "breaking", "now", "today", "report", "reports",
  "update", "updates", "news", "live",
]);

export function isLiveBlogUrl(url: string): boolean {
  if (!url) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return LIVE_PATH_PATTERNS.some((rx) => rx.test(path));
  } catch {
    return false;
  }
}

export function isLiveBlogTitle(title: string): boolean {
  if (!title) return false;
  return LIVE_TITLE_PATTERNS.some((rx) => rx.test(title));
}

export function isLiveBlog(title: string, url?: string | null): boolean {
  return isLiveBlogTitle(title) || (url ? isLiveBlogUrl(url) : false);
}

/**
 * Strip the "live: X" continuation from a live-blog title so two different
 * daily installments collapse onto the same signature.
 *
 * "Middle East crisis live: Iran reopens strait of Hormuz"
 *   → "Middle East crisis"
 * "Ukraine war live blog — day 500"
 *   → "Ukraine war"
 */
function extractLiveBlogTopic(title: string): string {
  const match = title.match(/^(.+?)\s+live\s*(?:blog|updates?|:|\-|–)/i);
  if (match && match[1].trim().length >= 3) {
    return match[1];
  }
  // Fallback: strip any trailing "live …" tail.
  return title.replace(/\s+live\b.*$/i, "").trim() || title;
}

function normalizeTokens(text: string, maxTokens = 8): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return tokens.slice(0, maxTokens).join(" ");
}

/**
 * Returns a stable "story signature". Empty string if the title does not
 * carry enough signal to dedup against (caller should then fall back to
 * URL-based dedup only).
 */
export function storySignature(title: string, url?: string | null): string {
  if (!title) return "";
  const trimmed = title.trim();
  const topic = isLiveBlog(trimmed, url) ? extractLiveBlogTopic(trimmed) : trimmed;
  const signature = normalizeTokens(topic);
  // Require at least two meaningful tokens; single-word titles are too noisy
  // to dedup safely (e.g. "Explosion" would collapse unrelated stories).
  return signature.split(" ").length >= 2 ? signature : "";
}

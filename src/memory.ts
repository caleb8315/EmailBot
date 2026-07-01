import { createLogger } from "./logger";
import {
  readJson,
  writeJson,
  localId,
  capArray,
} from "./local_store";
import type {
  UserPreferences,
  ArticleHistory,
  SourceRegistry,
  BriefingOverlay,
} from "./types";

const logger = createLogger("memory");

/**
 * Local-file memory for the basic bot (Supabase-free).
 *
 * Every function keeps the exact signature the rest of the pipeline expects, so
 * this is a drop-in replacement for the old Supabase-backed module. State lives
 * as JSON under `data/state/` (see `local_store.ts`).
 */

const PREFS_FILE = "preferences.json";
const ARTICLES_FILE = "articles.json";
const EVENTS_FILE = "system_events.json";
const DIGESTS_FILE = "digests.json";

// 8 days by default: the weekly recap looks back 7 days, so keep a little more.
// Lower it to shrink the committed data/state/articles.json (repo size), raise
// it if you want a longer history.
const ARTICLE_RETENTION_DAYS = Number.parseInt(
  process.env.ARTICLE_RETENTION_DAYS || "8",
  10
);
const MAX_EVENTS = 500;
const MAX_DIGESTS = 90;

// ── User Preferences ──

const DEFAULT_PREFERENCES: Omit<UserPreferences, "id" | "updated_at"> = {
  user_id: "default",
  interests: [],
  dislikes: [],
  alert_sensitivity: 5,
  trusted_sources: [],
  blocked_sources: [],
  briefing_overlay: {},
};

type PrefsMap = Record<string, UserPreferences>;

function readPrefs(): PrefsMap {
  return readJson<PrefsMap>(PREFS_FILE, {});
}

function normalizeUserPreferences(row: UserPreferences): UserPreferences {
  return {
    ...row,
    briefing_overlay:
      row.briefing_overlay && typeof row.briefing_overlay === "object"
        ? row.briefing_overlay
        : {},
  };
}

export async function getPreferences(
  userId: string
): Promise<UserPreferences> {
  try {
    const all = readPrefs();
    const existing = all[userId];
    if (existing) return normalizeUserPreferences(existing);

    const created: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      id: localId(),
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    all[userId] = created;
    writeJson(PREFS_FILE, all);
    logger.info("Created default preferences", { userId });
    return normalizeUserPreferences(created);
  } catch (err) {
    logger.error("getPreferences failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ...DEFAULT_PREFERENCES,
      id: "",
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
  }
}

export async function updatePreferences(
  userId: string,
  patch: Partial<
    Pick<
      UserPreferences,
      | "interests"
      | "dislikes"
      | "alert_sensitivity"
      | "trusted_sources"
      | "blocked_sources"
      | "briefing_overlay"
    >
  >
): Promise<void> {
  try {
    const all = readPrefs();
    const current =
      all[userId] ?? {
        ...DEFAULT_PREFERENCES,
        id: localId(),
        user_id: userId,
        updated_at: new Date().toISOString(),
      };
    all[userId] = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    writeJson(PREFS_FILE, all);
    logger.info("Preferences updated", { userId, fields: Object.keys(patch) });
  } catch (err) {
    logger.error("updatePreferences failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function patchBriefingOverlay(
  userId: string,
  mutator: (prev: BriefingOverlay) => BriefingOverlay
): Promise<void> {
  const prefs = await getPreferences(userId);
  const prev = prefs.briefing_overlay ?? {};
  const next = mutator(prev);
  next.updated_at = new Date().toISOString();
  await updatePreferences(userId, { briefing_overlay: next });
}

// ── Article History ──

function readArticles(): ArticleHistory[] {
  return readJson<ArticleHistory[]>(ARTICLES_FILE, []);
}

function pruneArticles(articles: ArticleHistory[]): ArticleHistory[] {
  const cutoff = Date.now() - ARTICLE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return articles.filter((a) => {
    const t = new Date(a.fetched_at).getTime();
    return Number.isFinite(t) ? t >= cutoff : true;
  });
}

function writeArticles(articles: ArticleHistory[]): void {
  writeJson(ARTICLES_FILE, pruneArticles(articles));
}

export async function saveArticle(
  article: Omit<ArticleHistory, "id">
): Promise<void> {
  try {
    const articles = readArticles();
    const idx = articles.findIndex((a) => a.url === article.url);
    if (idx >= 0) {
      articles[idx] = { ...articles[idx], ...article };
    } else {
      articles.push({ id: localId(), ...article });
    }
    writeArticles(articles);
    logger.debug("Article saved", { url: article.url });
  } catch (err) {
    logger.error("saveArticle failed", {
      error: err instanceof Error ? err.message : String(err),
      url: article.url,
    });
  }
}

export async function getArticleByUrl(
  url: string
): Promise<ArticleHistory | null> {
  try {
    return readArticles().find((a) => a.url === url) ?? null;
  } catch (err) {
    logger.error("getArticleByUrl failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function getRecentArticles(
  hours: number
): Promise<ArticleHistory[]> {
  try {
    const since = Date.now() - hours * 60 * 60 * 1000;
    return readArticles()
      .filter((a) => {
        const t = new Date(a.fetched_at).getTime();
        return Number.isFinite(t) && t >= since;
      })
      .sort(
        (a, b) =>
          new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
      );
  } catch (err) {
    logger.error("getRecentArticles failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function updateFeedback(
  url: string,
  feedback: string
): Promise<void> {
  try {
    const articles = readArticles();
    const idx = articles.findIndex((a) => a.url === url);
    if (idx < 0) return;
    articles[idx].user_feedback = feedback;
    writeArticles(articles);
    logger.info("Feedback recorded", { url, feedback });
  } catch (err) {
    logger.error("updateFeedback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Source Registry ──
// Not used in basic mode (sources come from config/sources.json). Kept for
// signature compatibility with callers.

export async function getSources(): Promise<SourceRegistry[]> {
  return [];
}

// ── Intel Events (for chat context) ──
// Intel events are produced by the "reasoning brain", which is disabled in basic
// mode. Return an empty list so chat context degrades gracefully.

export interface IntelEventContext {
  ref: string;
  source: string;
  type: string;
  severity: number;
  title: string;
  summary: string;
  timestamp: string;
  country_code: string;
  tags: string[];
  source_url: string | null;
}

export async function getRecentIntelEvents(
  _query: string,
  _opts: { hours?: number; limit?: number; severityMin?: number } = {}
): Promise<IntelEventContext[]> {
  return [];
}

// ── Alert Cooldown / status flags ──

export async function getLastAlertTime(): Promise<Date | null> {
  try {
    const alerted = readArticles().filter((a) => a.alerted && a.processed_at);
    if (alerted.length === 0) return null;
    const latest = alerted.reduce((max, a) => {
      const t = new Date(a.processed_at as string).getTime();
      return t > max ? t : max;
    }, 0);
    return latest > 0 ? new Date(latest) : null;
  } catch (err) {
    logger.error("getLastAlertTime failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function stampAlert(article: ArticleHistory): void {
  article.alerted = true;
  if (!article.processed_at) article.processed_at = new Date().toISOString();
}

export async function markAlerted(url: string): Promise<void> {
  try {
    const articles = readArticles();
    const idx = articles.findIndex((a) => a.url === url);
    if (idx >= 0) {
      stampAlert(articles[idx]);
    } else {
      // The pipeline may alert before the article row is persisted; create a
      // minimal row so cooldown + dedup still work.
      articles.push({
        id: localId(),
        url,
        title: "",
        source: "",
        summary: null,
        importance_score: null,
        credibility_score: null,
        relevance_score: null,
        ai_processed: false,
        user_feedback: null,
        alerted: true,
        emailed: false,
        fetched_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      });
    }
    writeArticles(articles);
  } catch (err) {
    logger.error("markAlerted failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function markEmailed(urls: string[]): Promise<void> {
  try {
    if (urls.length === 0) return;
    const set = new Set(urls);
    const articles = readArticles();
    let changed = false;
    for (const a of articles) {
      if (set.has(a.url) && !a.emailed) {
        a.emailed = true;
        changed = true;
      }
    }
    if (changed) writeArticles(articles);
  } catch (err) {
    logger.error("markEmailed failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getLastAlertedArticle(): Promise<ArticleHistory | null> {
  try {
    const alerted = readArticles().filter((a) => a.alerted);
    if (alerted.length === 0) return null;
    alerted.sort((a, b) => {
      const ta = new Date(a.processed_at ?? a.fetched_at).getTime();
      const tb = new Date(b.processed_at ?? b.fetched_at).getTime();
      return tb - ta;
    });
    return alerted[0] ?? null;
  } catch (err) {
    logger.error("getLastAlertedArticle failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Dashboard-style archive + system events (local rolling logs) ─────

export interface DigestArchiveRow {
  id: string;
  created_at: string;
  channels: string[];
  subject: string | null;
  html_body: string | null;
  plain_text: string;
  article_urls: unknown;
  meta: Record<string, unknown>;
}

export async function saveDigestArchive(row: {
  channels: string[];
  subject: string | null;
  html_body: string | null;
  plain_text: string;
  article_urls: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const rows = readJson<DigestArchiveRow[]>(DIGESTS_FILE, []);
    rows.push({
      id: localId(),
      created_at: new Date().toISOString(),
      channels: row.channels,
      subject: row.subject,
      html_body: row.html_body,
      plain_text: row.plain_text,
      article_urls: row.article_urls,
      meta: row.meta ?? {},
    });
    writeJson(DIGESTS_FILE, capArray(rows, MAX_DIGESTS));
  } catch (err) {
    logger.error("saveDigestArchive failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface SystemEventRow {
  id: string;
  created_at: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  meta: Record<string, unknown>;
}

export async function logSystemEvent(entry: {
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const rows = readJson<SystemEventRow[]>(EVENTS_FILE, []);
    rows.push({
      id: localId(),
      created_at: new Date().toISOString(),
      level: entry.level,
      source: entry.source,
      message: entry.message.slice(0, 8000),
      meta: entry.meta ?? {},
    });
    writeJson(EVENTS_FILE, capArray(rows, MAX_EVENTS));
  } catch (err) {
    logger.error("logSystemEvent failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

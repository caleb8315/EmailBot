import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "./logger";
import type {
  UserPreferences,
  ArticleHistory,
  SourceRegistry,
  BriefingOverlay,
} from "./types";

const logger = createLogger("memory");

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  _client = createClient(url, key);
  return _client;
}

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

export async function getPreferences(
  userId: string
): Promise<UserPreferences> {
  try {
    const sb = getClient();
    const { data, error } = await sb
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      logger.error("Failed to fetch preferences", { error: error.message });
      throw error;
    }

    if (data) {
      return normalizeUserPreferences(data as UserPreferences);
    }

    const { data: inserted, error: insertErr } = await sb
      .from("user_preferences")
      .insert({ ...DEFAULT_PREFERENCES, user_id: userId })
      .select("*")
      .single();

    if (insertErr) {
      logger.error("Failed to create default preferences", {
        error: insertErr.message,
      });
      throw insertErr;
    }

    logger.info("Created default preferences", { userId });
    return normalizeUserPreferences(inserted as UserPreferences);
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

function normalizeUserPreferences(row: UserPreferences): UserPreferences {
  return {
    ...row,
    briefing_overlay:
      row.briefing_overlay && typeof row.briefing_overlay === "object"
        ? row.briefing_overlay
        : {},
  };
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
    const sb = getClient();
    const { error } = await sb
      .from("user_preferences")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    if (error) {
      logger.error("Failed to update preferences", { error: error.message });
      throw error;
    }

    logger.info("Preferences updated", { userId, fields: Object.keys(patch) });
  } catch (err) {
    logger.error("updatePreferences failed", {
      error: err instanceof Error ? err.message : String(err),
    });
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

export async function saveArticle(
  article: Omit<ArticleHistory, "id">
): Promise<void> {
  try {
    const sb = getClient();
    const { error } = await sb.from("article_history").upsert(article, {
      onConflict: "url",
    });

    if (error) {
      logger.error("Failed to save article", { error: error.message });
      throw error;
    }

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
    const sb = getClient();
    const { data, error } = await sb
      .from("article_history")
      .select("*")
      .eq("url", url)
      .maybeSingle();

    if (error) {
      logger.error("Failed to fetch article", { error: error.message });
      return null;
    }

    return (data as ArticleHistory) ?? null;
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
    const sb = getClient();
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from("article_history")
      .select("*")
      .gte("fetched_at", since)
      .order("fetched_at", { ascending: false });

    if (error) {
      logger.error("Failed to fetch recent articles", {
        error: error.message,
      });
      return [];
    }

    return (data ?? []) as ArticleHistory[];
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
    const sb = getClient();
    const { error } = await sb
      .from("article_history")
      .update({ user_feedback: feedback })
      .eq("url", url);

    if (error) {
      logger.error("Failed to update feedback", { error: error.message });
    } else {
      logger.info("Feedback recorded", { url, feedback });
    }
  } catch (err) {
    logger.error("updateFeedback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Source Registry ──

export async function getSources(): Promise<SourceRegistry[]> {
  try {
    const sb = getClient();
    const { data, error } = await sb
      .from("source_registry")
      .select("*")
      .eq("active", true)
      .order("trust_score", { ascending: false });

    if (error) {
      logger.error("Failed to fetch sources", { error: error.message });
      return [];
    }

    return (data ?? []) as SourceRegistry[];
  } catch (err) {
    logger.error("getSources failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── Alert Cooldown ──

export async function getLastAlertTime(): Promise<Date | null> {
  try {
    const sb = getClient();
    const { data, error } = await sb
      .from("article_history")
      .select("processed_at")
      .eq("alerted", true)
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.processed_at) return null;
    return new Date(data.processed_at);
  } catch (err) {
    logger.error("getLastAlertTime failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function markAlerted(url: string): Promise<void> {
  try {
    const sb = getClient();
    const { error } = await sb
      .from("article_history")
      .update({ alerted: true })
      .eq("url", url);

    if (error) {
      logger.error("Failed to mark article as alerted", {
        error: error.message,
      });
    }
  } catch (err) {
    logger.error("markAlerted failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function markEmailed(urls: string[]): Promise<void> {
  try {
    if (urls.length === 0) return;
    const sb = getClient();
    const { error } = await sb
      .from("article_history")
      .update({ emailed: true })
      .in("url", urls);

    if (error) {
      logger.error("Failed to mark articles as emailed", {
        error: error.message,
      });
    }
  } catch (err) {
    logger.error("markEmailed failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getLastAlertedArticle(): Promise<ArticleHistory | null> {
  try {
    const sb = getClient();
    const { data, error } = await sb
      .from("article_history")
      .select("*")
      .eq("alerted", true)
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return (data as ArticleHistory) ?? null;
  } catch (err) {
    logger.error("getLastAlertedArticle failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Dashboard: digest archive + system events ─────────────────────

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
    const sb = getClient();
    const { error } = await sb.from("digest_archive").insert({
      channels: row.channels,
      subject: row.subject,
      html_body: row.html_body,
      plain_text: row.plain_text,
      article_urls: row.article_urls,
      meta: row.meta ?? {},
    });
    if (error) {
      logger.error("saveDigestArchive failed", { error: error.message });
    }
  } catch (err) {
    logger.error("saveDigestArchive failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function logSystemEvent(entry: {
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = getClient();
    const { error } = await sb.from("system_events").insert({
      level: entry.level,
      source: entry.source,
      message: entry.message.slice(0, 8000),
      meta: entry.meta ?? {},
    });
    if (error) {
      logger.error("logSystemEvent failed", { error: error.message });
    }
  } catch (err) {
    logger.error("logSystemEvent failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

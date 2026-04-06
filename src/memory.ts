import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "./logger";
import type {
  UserPreferences,
  ArticleHistory,
  SourceRegistry,
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

    if (data) return data as UserPreferences;

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
    return inserted as UserPreferences;
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

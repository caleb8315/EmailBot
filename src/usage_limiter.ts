import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "./logger";
import type { UsageReport } from "./types";

const logger = createLogger("usage_limiter");

const MAX_DAILY_AI_CALLS = parseInt(
  process.env.MAX_DAILY_AI_CALLS ?? "30",
  10
);

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    logger.warn("Supabase credentials missing — budget enforcement degraded");
    return null;
  }
  return createClient(url, key);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getOrCreateTodayRow(
  sb: SupabaseClient
): Promise<{ api_calls_used: number }> {
  const today = todayUTC();

  const { data, error } = await sb
    .from("usage_tracking")
    .select("api_calls_used")
    .eq("date", today)
    .maybeSingle();

  if (error) {
    logger.error("Failed to read usage_tracking", { error: error.message });
    throw error;
  }

  if (data) return data;

  const { data: inserted, error: insertErr } = await sb
    .from("usage_tracking")
    .insert({ date: today, api_calls_used: 0, last_reset_at: new Date().toISOString() })
    .select("api_calls_used")
    .single();

  if (insertErr) {
    logger.error("Failed to create usage_tracking row", {
      error: insertErr.message,
    });
    throw insertErr;
  }

  return inserted;
}

export async function canMakeAICall(): Promise<boolean> {
  try {
    const sb = getSupabase();
    if (!sb) {
      logger.warn("No Supabase — fail closed, denying AI call");
      return false;
    }
    const row = await getOrCreateTodayRow(sb);
    const allowed = row.api_calls_used < MAX_DAILY_AI_CALLS;
    logger.debug("Budget check", {
      used: row.api_calls_used,
      max: MAX_DAILY_AI_CALLS,
      allowed,
    });
    return allowed;
  } catch (err) {
    logger.error("Budget check failed — fail closed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function recordAICall(): Promise<void> {
  try {
    const sb = getSupabase();
    if (!sb) {
      logger.warn("No Supabase — cannot record AI call");
      return;
    }
    const today = todayUTC();
    const row = await getOrCreateTodayRow(sb);

    const { error } = await sb
      .from("usage_tracking")
      .update({
        api_calls_used: row.api_calls_used + 1,
        last_reset_at: new Date().toISOString(),
      })
      .eq("date", today);

    if (error) {
      logger.error("Failed to record AI call", { error: error.message });
    } else {
      logger.info("AI call recorded", { total: row.api_calls_used + 1 });
    }
  } catch (err) {
    logger.error("recordAICall failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getRemainingCalls(): Promise<number> {
  try {
    const sb = getSupabase();
    if (!sb) return 0;
    const row = await getOrCreateTodayRow(sb);
    return Math.max(0, MAX_DAILY_AI_CALLS - row.api_calls_used);
  } catch (err) {
    logger.error("getRemainingCalls failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

export async function getDailyUsageReport(): Promise<UsageReport> {
  try {
    const sb = getSupabase();
    if (!sb) {
      return {
        date: todayUTC(),
        callsUsed: 0,
        callsRemaining: 0,
        maxCalls: MAX_DAILY_AI_CALLS,
      };
    }
    const row = await getOrCreateTodayRow(sb);
    return {
      date: todayUTC(),
      callsUsed: row.api_calls_used,
      callsRemaining: Math.max(0, MAX_DAILY_AI_CALLS - row.api_calls_used),
      maxCalls: MAX_DAILY_AI_CALLS,
    };
  } catch (err) {
    logger.error("getDailyUsageReport failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      date: todayUTC(),
      callsUsed: 0,
      callsRemaining: 0,
      maxCalls: MAX_DAILY_AI_CALLS,
    };
  }
}

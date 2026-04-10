import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "./logger";
import type { UsageReport } from "./types";

const logger = createLogger("usage_limiter");

export type AICallPurpose = "chat" | "pipeline" | "digest" | "other";

interface UsageTrackingRow {
  api_calls_used: number;
  chat_calls_used: number;
  pipeline_calls_used: number;
  digest_calls_used: number;
  other_calls_used: number;
}

const PURPOSE_COLUMNS: Record<AICallPurpose, keyof UsageTrackingRow> = {
  chat: "chat_calls_used",
  pipeline: "pipeline_calls_used",
  digest: "digest_calls_used",
  other: "other_calls_used",
};

function parseLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

const MAX_DAILY_AI_CALLS = parseLimit("MAX_DAILY_AI_CALLS", 30);
const MAX_DAILY_CHAT_CALLS = parseLimit("MAX_DAILY_CHAT_CALLS", 20);
const MAX_DAILY_PIPELINE_AI_CALLS = parseLimit(
  "MAX_DAILY_PIPELINE_AI_CALLS",
  MAX_DAILY_AI_CALLS
);
const MAX_DAILY_DIGEST_AI_CALLS = parseLimit("MAX_DAILY_DIGEST_AI_CALLS", 4);
const MAX_DAILY_OTHER_AI_CALLS = parseLimit(
  "MAX_DAILY_OTHER_AI_CALLS",
  MAX_DAILY_AI_CALLS
);

let supportsPurposeColumns: boolean | null = null;

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

function usesPurposeColumns(): boolean {
  return supportsPurposeColumns !== false;
}

function hasMissingPurposeColumnError(message: string): boolean {
  return (
    message.includes("chat_calls_used") ||
    message.includes("pipeline_calls_used") ||
    message.includes("digest_calls_used") ||
    message.includes("other_calls_used")
  );
}

function normalizeRow(row: Partial<UsageTrackingRow>): UsageTrackingRow {
  return {
    api_calls_used: Number(row.api_calls_used ?? 0),
    chat_calls_used: Number(row.chat_calls_used ?? 0),
    pipeline_calls_used: Number(row.pipeline_calls_used ?? 0),
    digest_calls_used: Number(row.digest_calls_used ?? 0),
    other_calls_used: Number(row.other_calls_used ?? 0),
  };
}

function purposeLimit(purpose: AICallPurpose): number {
  switch (purpose) {
    case "chat":
      return MAX_DAILY_CHAT_CALLS;
    case "pipeline":
      return MAX_DAILY_PIPELINE_AI_CALLS;
    case "digest":
      return MAX_DAILY_DIGEST_AI_CALLS;
    case "other":
    default:
      return MAX_DAILY_OTHER_AI_CALLS;
  }
}

function purposeUsage(row: UsageTrackingRow, purpose: AICallPurpose): number {
  if (!usesPurposeColumns()) {
    // Backward-compatible fallback if DB migration has not been run yet.
    return row.api_calls_used;
  }
  return row[PURPOSE_COLUMNS[purpose]];
}

function usageSelectColumns(): string {
  return usesPurposeColumns()
    ? "api_calls_used,chat_calls_used,pipeline_calls_used,digest_calls_used,other_calls_used"
    : "api_calls_used";
}

async function readTodayRow(
  sb: SupabaseClient,
  today: string
): Promise<UsageTrackingRow | null> {
  const { data, error } = await sb
    .from("usage_tracking")
    .select(usageSelectColumns())
    .eq("date", today)
    .maybeSingle();

  if (error) {
    if (usesPurposeColumns() && hasMissingPurposeColumnError(error.message)) {
      supportsPurposeColumns = false;
      logger.warn(
        "usage_tracking purpose columns missing; falling back to global-only limits"
      );
      return readTodayRow(sb, today);
    }
    logger.error("Failed to read usage_tracking", { error: error.message });
    throw error;
  }

  if (!data) return null;
  return normalizeRow(data as Partial<UsageTrackingRow>);
}

async function insertTodayRow(
  sb: SupabaseClient,
  today: string
): Promise<UsageTrackingRow> {
  const base = { date: today, api_calls_used: 0, last_reset_at: new Date().toISOString() };
  const payload = usesPurposeColumns()
    ? {
        ...base,
        chat_calls_used: 0,
        pipeline_calls_used: 0,
        digest_calls_used: 0,
        other_calls_used: 0,
      }
    : base;

  const { data, error } = await sb
    .from("usage_tracking")
    .insert(payload)
    .select(usageSelectColumns())
    .single();

  if (error) {
    if (usesPurposeColumns() && hasMissingPurposeColumnError(error.message)) {
      supportsPurposeColumns = false;
      logger.warn(
        "usage_tracking purpose columns missing during insert; falling back to global-only limits"
      );
      return insertTodayRow(sb, today);
    }
    logger.error("Failed to create usage_tracking row", {
      error: error.message,
    });
    throw error;
  }

  return normalizeRow(data as Partial<UsageTrackingRow>);
}

async function getOrCreateTodayRow(
  sb: SupabaseClient
): Promise<UsageTrackingRow> {
  const today = todayUTC();
  const existing = await readTodayRow(sb, today);
  if (existing) return existing;
  return insertTodayRow(sb, today);
}

function emptyUsageReport(callsRemaining = 0): UsageReport {
  return {
    date: todayUTC(),
    callsUsed: 0,
    callsRemaining,
    maxCalls: MAX_DAILY_AI_CALLS,
    chatCallsUsed: 0,
    chatCallsRemaining: 0,
    maxChatCalls: MAX_DAILY_CHAT_CALLS,
    pipelineCallsUsed: 0,
    digestCallsUsed: 0,
  };
}

export async function canMakeAICall(
  purpose: AICallPurpose = "other"
): Promise<boolean> {
  try {
    const sb = getSupabase();
    if (!sb) {
      logger.warn("No Supabase — fail closed, denying AI call");
      return false;
    }
    const row = await getOrCreateTodayRow(sb);
    const totalAllowed = row.api_calls_used < MAX_DAILY_AI_CALLS;
    const bucketLimit = purposeLimit(purpose);
    const bucketUsed = purposeUsage(row, purpose);
    const bucketAllowed = bucketUsed < bucketLimit;
    const allowed = totalAllowed && bucketAllowed;

    logger.debug("Budget check", {
      purpose,
      used: row.api_calls_used,
      max: MAX_DAILY_AI_CALLS,
      bucketUsed,
      bucketLimit,
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

export async function recordAICall(purpose: AICallPurpose = "other"): Promise<void> {
  try {
    const sb = getSupabase();
    if (!sb) {
      logger.warn("No Supabase — cannot record AI call");
      return;
    }
    const today = todayUTC();
    const row = await getOrCreateTodayRow(sb);

    const updatePayload: Record<string, number | string> = {
      api_calls_used: row.api_calls_used + 1,
      last_reset_at: new Date().toISOString(),
    };
    if (usesPurposeColumns()) {
      const col = PURPOSE_COLUMNS[purpose];
      updatePayload[col] = row[col] + 1;
    }

    const { error } = await sb
      .from("usage_tracking")
      .update(updatePayload)
      .eq("date", today);

    if (error) {
      if (usesPurposeColumns() && hasMissingPurposeColumnError(error.message)) {
        supportsPurposeColumns = false;
        logger.warn(
          "usage_tracking purpose columns missing during update; retrying with global-only counter"
        );
        await recordAICall(purpose);
        return;
      }
      logger.error("Failed to record AI call", { error: error.message });
    } else {
      logger.info("AI call recorded", {
        purpose,
        total: row.api_calls_used + 1,
      });
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
      return emptyUsageReport(0);
    }
    const row = await getOrCreateTodayRow(sb);
    const chatUsed = purposeUsage(row, "chat");
    return {
      date: todayUTC(),
      callsUsed: row.api_calls_used,
      callsRemaining: Math.max(0, MAX_DAILY_AI_CALLS - row.api_calls_used),
      maxCalls: MAX_DAILY_AI_CALLS,
      chatCallsUsed: chatUsed,
      chatCallsRemaining: Math.max(0, MAX_DAILY_CHAT_CALLS - chatUsed),
      maxChatCalls: MAX_DAILY_CHAT_CALLS,
      pipelineCallsUsed: purposeUsage(row, "pipeline"),
      digestCallsUsed: purposeUsage(row, "digest"),
    };
  } catch (err) {
    logger.error("getDailyUsageReport failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return emptyUsageReport(0);
  }
}

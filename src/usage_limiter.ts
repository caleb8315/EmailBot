import { createLogger } from "./logger";
import { readJson, writeJson, todayUTC } from "./local_store";
import type { UsageReport } from "./types";

const logger = createLogger("usage_limiter");

/**
 * Daily AI-call budget, tracked in a local JSON file (Supabase-free).
 * Keeps the same public API as before so callers are unchanged.
 */

export type AICallPurpose = "chat" | "pipeline" | "digest" | "ingest" | "other";

interface UsageRow {
  api_calls_used: number;
  chat_calls_used: number;
  pipeline_calls_used: number;
  digest_calls_used: number;
  other_calls_used: number;
  last_reset_at: string;
}

type UsageMap = Record<string, UsageRow>;

const USAGE_FILE = "usage.json";
const RETAIN_DAYS = 14;

const PURPOSE_COLUMNS: Record<AICallPurpose, keyof UsageRow> = {
  chat: "chat_calls_used",
  pipeline: "pipeline_calls_used",
  digest: "digest_calls_used",
  ingest: "other_calls_used",
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
const MAX_DAILY_INGEST_AI_CALLS = parseLimit("MAX_DAILY_INGEST_AI_CALLS", 15);
const MAX_DAILY_OTHER_AI_CALLS = parseLimit(
  "MAX_DAILY_OTHER_AI_CALLS",
  MAX_DAILY_AI_CALLS
);

function emptyRow(): UsageRow {
  return {
    api_calls_used: 0,
    chat_calls_used: 0,
    pipeline_calls_used: 0,
    digest_calls_used: 0,
    other_calls_used: 0,
    last_reset_at: new Date().toISOString(),
  };
}

function pruneOldDates(map: UsageMap): UsageMap {
  const dates = Object.keys(map).sort();
  if (dates.length <= RETAIN_DAYS) return map;
  const keep = new Set(dates.slice(dates.length - RETAIN_DAYS));
  const next: UsageMap = {};
  for (const d of dates) if (keep.has(d)) next[d] = map[d];
  return next;
}

function readToday(): { map: UsageMap; row: UsageRow; today: string } {
  const today = todayUTC();
  const map = readJson<UsageMap>(USAGE_FILE, {});
  const row = map[today] ?? emptyRow();
  return { map, row, today };
}

function purposeLimit(purpose: AICallPurpose): number {
  switch (purpose) {
    case "chat":
      return MAX_DAILY_CHAT_CALLS;
    case "pipeline":
      return MAX_DAILY_PIPELINE_AI_CALLS;
    case "digest":
      return MAX_DAILY_DIGEST_AI_CALLS;
    case "ingest":
      return MAX_DAILY_INGEST_AI_CALLS;
    case "other":
    default:
      return MAX_DAILY_OTHER_AI_CALLS;
  }
}

function emptyUsageReport(): UsageReport {
  return {
    date: todayUTC(),
    callsUsed: 0,
    callsRemaining: MAX_DAILY_AI_CALLS,
    maxCalls: MAX_DAILY_AI_CALLS,
    chatCallsUsed: 0,
    chatCallsRemaining: MAX_DAILY_CHAT_CALLS,
    maxChatCalls: MAX_DAILY_CHAT_CALLS,
    pipelineCallsUsed: 0,
    digestCallsUsed: 0,
  };
}

export async function canMakeAICall(
  purpose: AICallPurpose = "other"
): Promise<boolean> {
  try {
    const { row } = readToday();
    const totalAllowed = row.api_calls_used < MAX_DAILY_AI_CALLS;
    const bucketUsed = row[PURPOSE_COLUMNS[purpose]] as number;
    const bucketAllowed = bucketUsed < purposeLimit(purpose);
    const allowed = totalAllowed && bucketAllowed;
    logger.debug("Budget check", {
      purpose,
      used: row.api_calls_used,
      max: MAX_DAILY_AI_CALLS,
      bucketUsed,
      bucketLimit: purposeLimit(purpose),
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

export async function recordAICall(
  purpose: AICallPurpose = "other"
): Promise<void> {
  try {
    const { map, row, today } = readToday();
    row.api_calls_used += 1;
    const col = PURPOSE_COLUMNS[purpose];
    (row[col] as number) += 1;
    row.last_reset_at = new Date().toISOString();
    map[today] = row;
    writeJson(USAGE_FILE, pruneOldDates(map));
    logger.info("AI call recorded", { purpose, total: row.api_calls_used });
  } catch (err) {
    logger.error("recordAICall failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getRemainingCalls(): Promise<number> {
  try {
    const { row } = readToday();
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
    const { row } = readToday();
    return {
      date: todayUTC(),
      callsUsed: row.api_calls_used,
      callsRemaining: Math.max(0, MAX_DAILY_AI_CALLS - row.api_calls_used),
      maxCalls: MAX_DAILY_AI_CALLS,
      chatCallsUsed: row.chat_calls_used,
      chatCallsRemaining: Math.max(0, MAX_DAILY_CHAT_CALLS - row.chat_calls_used),
      maxChatCalls: MAX_DAILY_CHAT_CALLS,
      pipelineCallsUsed: row.pipeline_calls_used,
      digestCallsUsed: row.digest_calls_used,
    };
  } catch (err) {
    logger.error("getDailyUsageReport failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return emptyUsageReport();
  }
}

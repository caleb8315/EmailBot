import { trySharedSupabase } from "./supabase";

export type EngineId = "news_pipeline" | "world_ingest" | "dreamtime" | "digest" | "weekly_digest" | "deep_intel";
export type RunStatus = "running" | "success" | "partial" | "error";

export interface EngineRun {
  id: string;
  engine: EngineId;
  started_at: string;
  finished_at?: string;
  status: RunStatus;
  records_in: number;
  records_out: number;
  ai_calls_used: number;
  errors: string[];
  meta: Record<string, unknown>;
}

export async function startEngineRun(engine: EngineId, meta?: Record<string, unknown>): Promise<string | null> {
  const sb = trySharedSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("engine_runs")
    .insert({ engine, meta: meta ?? {} })
    .select("id")
    .single();
  if (error) {
    console.error(`[engine-run] Failed to start ${engine} run:`, error.message);
    return null;
  }
  return data.id;
}

export async function finishEngineRun(
  runId: string | null,
  update: {
    status: RunStatus;
    records_in?: number;
    records_out?: number;
    ai_calls_used?: number;
    errors?: string[];
    meta?: Record<string, unknown>;
  }
): Promise<void> {
  if (!runId) return;
  const sb = trySharedSupabase();
  if (!sb) return;

  const { error } = await sb
    .from("engine_runs")
    .update({
      finished_at: new Date().toISOString(),
      status: update.status,
      records_in: update.records_in ?? 0,
      records_out: update.records_out ?? 0,
      ai_calls_used: update.ai_calls_used ?? 0,
      errors: update.errors ?? [],
      meta: update.meta ?? {},
    })
    .eq("id", runId);

  if (error) console.error(`[engine-run] Failed to finish run ${runId}:`, error.message);
}

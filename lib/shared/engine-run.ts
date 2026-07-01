import {
  readJson,
  writeJson,
  localId,
  capArray,
} from "../../src/local_store";

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

const RUNS_FILE = "engine_runs.json";
const MAX_RUNS = 200;

function readRuns(): EngineRun[] {
  return readJson<EngineRun[]>(RUNS_FILE, []);
}

function writeRuns(runs: EngineRun[]): void {
  writeJson(RUNS_FILE, capArray(runs, MAX_RUNS));
}

export async function startEngineRun(
  engine: EngineId,
  meta?: Record<string, unknown>
): Promise<string | null> {
  try {
    const runs = readRuns();
    const run: EngineRun = {
      id: localId(),
      engine,
      started_at: new Date().toISOString(),
      status: "running",
      records_in: 0,
      records_out: 0,
      ai_calls_used: 0,
      errors: [],
      meta: meta ?? {},
    };
    runs.push(run);
    writeRuns(runs);
    return run.id;
  } catch (err) {
    console.error(`[engine-run] Failed to start ${engine} run:`, err);
    return null;
  }
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
  try {
    const runs = readRuns();
    const idx = runs.findIndex((r) => r.id === runId);
    if (idx < 0) return;
    runs[idx] = {
      ...runs[idx],
      finished_at: new Date().toISOString(),
      status: update.status,
      records_in: update.records_in ?? 0,
      records_out: update.records_out ?? 0,
      ai_calls_used: update.ai_calls_used ?? 0,
      errors: update.errors ?? [],
      meta: update.meta ?? {},
    };
    writeRuns(runs);
  } catch (err) {
    console.error(`[engine-run] Failed to finish run ${runId}:`, err);
  }
}

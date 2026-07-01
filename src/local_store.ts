import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createLogger } from "./logger";

const logger = createLogger("local_store");

/**
 * Local JSON store — the Supabase-free backing for the basic news/intel bot.
 *
 * Why this exists: the free Supabase tier gets maxed out (and can lock you out).
 * The basic bot only needs a little durable state — seen-article history for
 * dedup, daily AI usage counters, last-alert time for cooldown, and a rolling
 * log of runs/events/digests. All of that lives here as small JSON files under
 * `data/state/` and is committed back to the repo by the GitHub Actions
 * workflows, so state survives across ephemeral runs without any database.
 *
 * Supabase is still used by the dashboard for auth — this module intentionally
 * only replaces the bot's operational data layer.
 */

export const STATE_DIR = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORE_DIR || "data/state"
);

function ensureDir(): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch (err) {
    logger.error("Failed to create state dir", {
      dir: STATE_DIR,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function filePath(name: string): string {
  return path.join(STATE_DIR, name);
}

/** Read a JSON file, returning `fallback` if it is missing or unparseable. */
export function readJson<T>(name: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath(name), "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      logger.warn("Failed to read state file — using fallback", {
        file: name,
        error: e.message,
      });
    }
    return fallback;
  }
}

/** Write a JSON file atomically (temp file + rename) and optionally git-sync. */
export function writeJson(name: string, data: unknown): void {
  ensureDir();
  const target = filePath(name);
  const tmp = path.join(
    STATE_DIR,
    `.${name}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, target);
  } catch (err) {
    logger.error("Failed to write state file", {
      file: name,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best effort
    }
    return;
  }
  maybeGitSync(name);
}

/**
 * Best-effort commit + push of the state dir.
 *
 * Off by default. The GitHub Actions workflows persist state with their own git
 * steps, so this is only meant for a long-running local process (the Telegram
 * bot) that should push preference edits back to the repo. Enable with
 * `LOCAL_STORE_GIT_SYNC=true`. All failures are swallowed — losing a sync must
 * never crash the bot.
 */
let gitSyncWarned = false;
function maybeGitSync(name: string): void {
  if (process.env.LOCAL_STORE_GIT_SYNC !== "true") return;
  try {
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: process.cwd(),
        stdio: "pipe",
        encoding: "utf-8",
      });
    git(["add", STATE_DIR]);
    // Nothing staged? `git diff --cached --quiet` exits 0 → skip commit.
    try {
      git(["diff", "--cached", "--quiet"]);
      return; // no changes
    } catch {
      // non-zero exit means there ARE staged changes — proceed to commit
    }
    git(["commit", "-m", `chore(state): update ${name} [skip ci]`]);
    try {
      git(["pull", "--rebase", "--autostash"]);
    } catch {
      // best effort — push may still succeed / fail below
    }
    git(["push"]);
    logger.debug("State git-synced", { file: name });
  } catch (err) {
    if (!gitSyncWarned) {
      gitSyncWarned = true;
      logger.warn("LOCAL_STORE_GIT_SYNC enabled but git sync failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Simple UUID-ish id for local rows (no external dep). */
export function localId(): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${rnd}`;
}

/** Trim an array to the most recent `max` items (assumes newest-last order). */
export function capArray<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return items.slice(items.length - max);
}

/** For debugging: where is state stored, and is git-sync on? */
export function describeStore(): string {
  const rel = path.relative(process.cwd(), STATE_DIR) || STATE_DIR;
  const sync = process.env.LOCAL_STORE_GIT_SYNC === "true" ? "on" : "off";
  return `local store at ${rel} (git-sync ${sync}, host ${os.hostname()})`;
}

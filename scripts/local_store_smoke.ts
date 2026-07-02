import fs from "fs";
import path from "path";
import os from "os";

process.env.LOCAL_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "store-"));

import {
  getPreferences,
  updatePreferences,
  patchBriefingOverlay,
  saveArticle,
  getRecentArticles,
  getArticleByUrl,
  markAlerted,
  getLastAlertTime,
  getLastAlertedArticle,
  markEmailed,
  saveDigestArchive,
  logSystemEvent,
  getRecentIntelEvents,
  getSources,
} from "../src/memory";
import {
  canMakeAICall,
  recordAICall,
  getDailyUsageReport,
} from "../src/usage_limiter";
import { startEngineRun, finishEngineRun } from "../lib/shared/engine-run";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

async function main(): Promise<void> {
  console.log(`state dir: ${process.env.LOCAL_STORE_DIR}`);

  // Preferences
  const p0 = await getPreferences("user-1");
  check("default prefs created", p0.user_id === "user-1" && p0.alert_sensitivity === 5);
  await updatePreferences("user-1", { alert_sensitivity: 8, interests: ["AI"] });
  const p1 = await getPreferences("user-1");
  check("prefs updated + persisted", p1.alert_sensitivity === 8 && p1.interests[0] === "AI");
  await patchBriefingOverlay("user-1", (prev) => ({ ...prev, tier1_keywords: ["fed"] }));
  const p2 = await getPreferences("user-1");
  check("briefing overlay patched", (p2.briefing_overlay?.tier1_keywords ?? [])[0] === "fed");

  // Articles + dedup
  const now = new Date().toISOString();
  await saveArticle({
    url: "https://x.com/a", title: "A", source: "x", summary: "s",
    importance_score: 9, credibility_score: 8, relevance_score: 7,
    ai_processed: true, user_feedback: null, alerted: false, emailed: false,
    fetched_at: now, processed_at: now,
  });
  await saveArticle({
    url: "https://x.com/a", title: "A-updated", source: "x", summary: "s2",
    importance_score: 9, credibility_score: 8, relevance_score: 7,
    ai_processed: true, user_feedback: null, alerted: false, emailed: false,
    fetched_at: now, processed_at: now,
  });
  const recent = await getRecentArticles(72);
  check("upsert dedups by url", recent.length === 1 && recent[0].title === "A-updated");
  const byUrl = await getArticleByUrl("https://x.com/a");
  check("getArticleByUrl works", byUrl?.url === "https://x.com/a");

  // Old article excluded from recent window
  await saveArticle({
    url: "https://x.com/old", title: "old", source: "x", summary: null,
    importance_score: null, credibility_score: null, relevance_score: null,
    ai_processed: false, user_feedback: null, alerted: false, emailed: false,
    fetched_at: new Date(Date.now() - 100 * 3600 * 1000).toISOString(),
    processed_at: null,
  });
  const recent2 = await getRecentArticles(72);
  check("recent window filters old", recent2.every((a) => a.url !== "https://x.com/old"));

  // Alerts / cooldown
  check("no last-alert yet", (await getLastAlertTime()) === null);
  await markAlerted("https://x.com/a");
  check("last-alert time set", (await getLastAlertTime()) instanceof Date);
  const lastAlerted = await getLastAlertedArticle();
  check("last-alerted article", lastAlerted?.url === "https://x.com/a");
  await markAlerted("https://x.com/created-by-alert");
  check("markAlerted creates missing row", (await getArticleByUrl("https://x.com/created-by-alert")) !== null);

  // Emailed flag
  await markEmailed(["https://x.com/a"]);
  check("markEmailed sets flag", (await getArticleByUrl("https://x.com/a"))?.emailed === true);

  // Usage budget
  const canBefore = await canMakeAICall("pipeline");
  check("can make AI call initially", canBefore === true);
  await recordAICall("pipeline");
  await recordAICall("digest");
  const report = await getDailyUsageReport();
  check("usage counted", report.callsUsed === 2 && report.pipelineCallsUsed === 1 && report.digestCallsUsed === 1);

  // Engine runs
  const runId = await startEngineRun("news_pipeline", { test: true });
  check("engine run started", typeof runId === "string" && !!runId);
  await finishEngineRun(runId, { status: "success", records_in: 5, records_out: 2 });
  const runs = JSON.parse(fs.readFileSync(path.join(process.env.LOCAL_STORE_DIR!, "engine_runs.json"), "utf-8"));
  check("engine run finished", runs[0].status === "success" && runs[0].records_out === 2);

  // Archive + events + brain stubs
  await saveDigestArchive({ channels: ["telegram"], subject: null, html_body: null, plain_text: "hi", article_urls: ["https://x.com/a"] });
  await logSystemEvent({ level: "info", source: "test", message: "hello" });
  check("intel events empty in basic mode", (await getRecentIntelEvents("q")).length === 0);
  check("sources empty in basic mode", (await getSources()).length === 0);

  // Cleanup temp dir
  fs.rmSync(process.env.LOCAL_STORE_DIR!, { recursive: true, force: true });

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

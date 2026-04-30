import { createLogger } from "./logger";
import { logSystemEvent } from "./memory";
import { getPreferences, getRecentArticles } from "./memory";
import { fetchAllSources, getSourcesConfig } from "./fetch_sources";
import { prefilterArticles } from "./prefilter";
import { processArticles } from "./process_articles";
import { sendAlertIfNeeded } from "./send_telegram";
import { sendPlainMessage } from "./send_telegram";
import { getDailyUsageReport } from "./usage_limiter";
import { resolvePreferenceUserId } from "./user_identity";
import type { RawArticle, ArticleHistory, NewsVerificationStatus } from "./types";
import {
  extractCanonicalDomain,
  isDomainCredible,
  isDomainBlocked,
} from "../lib/verification";

const logger = createLogger("index");

const PREFERENCE_USER_ID = resolvePreferenceUserId();

async function loadPreferences() {
  logger.info("Loading user preferences", { userId: PREFERENCE_USER_ID });
  return getPreferences(PREFERENCE_USER_ID);
}

async function fetchArticles(): Promise<RawArticle[]> {
  logger.info("Fetching articles from all sources");
  return fetchAllSources();
}

async function deduplicateAgainstHistory(
  articles: RawArticle[]
): Promise<{ articles: RawArticle[]; existingUrls: Set<string> }> {
  logger.info("Deduplicating against article history");
  const recent = await getRecentArticles(72);
  const existingUrls = new Set(recent.map((a) => a.url));
  const fresh = articles.filter((a) => !existingUrls.has(a.url));
  logger.info("Deduplication complete", {
    incoming: articles.length,
    alreadySeen: articles.length - fresh.length,
    fresh: fresh.length,
  });
  return { articles: fresh, existingUrls };
}

async function runPipeline(): Promise<void> {
  const { startEngineRun, finishEngineRun } = await import('../lib/shared/engine-run');
  const engineRunId = await startEngineRun('news_pipeline');
  const startTime = Date.now();
  logger.info("Pipeline started");

  // Step 1: Load preferences
  let prefs;
  try {
    prefs = await loadPreferences();
  } catch (err) {
    logger.error("Step 1 failed: load preferences", {
      error: err instanceof Error ? err.message : String(err),
    });
    prefs = {
      id: "",
      user_id: PREFERENCE_USER_ID,
      interests: [],
      dislikes: [],
      alert_sensitivity: 5,
      trusted_sources: [],
      blocked_sources: [],
      briefing_overlay: {},
      updated_at: new Date().toISOString(),
    };
  }

  // Merge config-level trusted/blocked sources with user prefs
  try {
    const config = getSourcesConfig();
    prefs = {
      ...prefs,
      trusted_sources: [
        ...new Set([...prefs.trusted_sources, ...config.trusted_domains]),
      ],
      blocked_sources: [
        ...new Set([...prefs.blocked_sources, ...config.blocked_domains]),
      ],
    };
  } catch (err) {
    logger.error("Failed to merge source config", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 2: Fetch articles
  let rawArticles: RawArticle[] = [];
  try {
    rawArticles = await fetchArticles();
  } catch (err) {
    logger.error("Step 2 failed: fetch articles", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (rawArticles.length === 0) {
    logger.warn("No articles fetched — pipeline ending early");
    await finishEngineRun(engineRunId, { status: 'success', records_in: 0, records_out: 0 });
    return;
  }

  // Step 3: Deduplicate
  let freshArticles = rawArticles;
  let existingUrls = new Set<string>();
  try {
    const result = await deduplicateAgainstHistory(rawArticles);
    freshArticles = result.articles;
    existingUrls = result.existingUrls;
  } catch (err) {
    logger.error("Step 3 failed: deduplication", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (freshArticles.length === 0) {
    logger.info("No new articles after dedup — pipeline complete");
    await finishEngineRun(engineRunId, { status: 'success', records_in: rawArticles.length, records_out: 0 });
    return;
  }

  // Step 4: Prefilter
  let filtered;
  try {
    filtered = prefilterArticles(freshArticles, prefs, existingUrls);
  } catch (err) {
    logger.error("Step 4 failed: prefilter", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Step 5: Process with AI (budget-gated)
  let processingResult;
  try {
    processingResult = await processArticles(filtered, prefs);
  } catch (err) {
    logger.error("Step 5 failed: AI processing", {
      error: err instanceof Error ? err.message : String(err),
    });
    processingResult = {
      processed: [],
      skippedBudget: 0,
      skippedError: 0,
      aiCallsMade: 0,
    };
  }

  // Step 6: Assign verification status and check alert thresholds
  let alertsSent = 0;
  let quarantinedCount = 0;
  const alertSensitivity =
    typeof prefs.alert_sensitivity === "number"
      ? prefs.alert_sensitivity
      : 5;
  for (const article of processingResult.processed) {
    try {
      const domain = extractCanonicalDomain(article.url);
      const credible = isDomainCredible(domain);
      const corrobCount = article.corroboration_count ?? 1;

      let vStatus: NewsVerificationStatus;
      if (isDomainBlocked(domain, prefs.blocked_sources)) {
        vStatus = 'blocked';
      } else if (corrobCount >= 2 && credible) {
        vStatus = 'verified';
      } else if (corrobCount >= 2) {
        vStatus = 'developing';
      } else if (credible) {
        vStatus = 'developing';
      } else {
        vStatus = 'quarantined';
      }

      article.verification_status = vStatus;

      if (vStatus === 'blocked') {
        logger.debug("Blocked article skipped", { title: article.title.slice(0, 60), domain });
        continue;
      }

      if (vStatus === 'quarantined') {
        quarantinedCount++;
        logger.debug("Article quarantined — insufficient verification", {
          title: article.title.slice(0, 60),
          corroboration: corrobCount,
          credible,
        });
        continue;
      }

      const sent = await sendAlertIfNeeded(article, alertSensitivity);
      if (sent) alertsSent++;
    } catch (err) {
      logger.error("Step 6 failed: alert check", {
        title: article.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (quarantinedCount > 0) {
    logger.info("Quarantined articles (not alerted)", { count: quarantinedCount });
  }

  // Step 7: Log summary
  let usage;
  try {
    usage = await getDailyUsageReport();
  } catch (err) {
    logger.error("Failed to get usage report", {
      error: err instanceof Error ? err.message : String(err),
    });
    usage = {
      date: "",
      callsUsed: 0,
      callsRemaining: 0,
      maxCalls: 5,
      chatCallsUsed: 0,
      chatCallsRemaining: 0,
      maxChatCalls: 20,
      pipelineCallsUsed: 0,
      digestCallsUsed: 0,
    };
  }

  const elapsed = Date.now() - startTime;
  await finishEngineRun(engineRunId, {
    status: 'success',
    records_in: rawArticles.length,
    records_out: processingResult.processed.length,
    ai_calls_used: processingResult.aiCallsMade,
    meta: { elapsed_ms: elapsed, alerts_sent: alertsSent },
  });
  logger.info("Pipeline complete", {
    durationMs: elapsed,
    fetched: rawArticles.length,
    fresh: freshArticles.length,
    aiCalls: processingResult.aiCallsMade,
    budgetUsed: `${usage.callsUsed}/${usage.maxCalls}`,
    alertsSent,
  });
}

// ── Entry Point ──
runPipeline()
  .then(() => {
    logger.info("Pipeline exiting cleanly");
    process.exit(0);
  })
  .catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Pipeline crashed", { error: msg });
    await logSystemEvent({
      level: "error",
      source: "pipeline",
      message: `Pipeline crashed: ${msg}`,
    });
    try {
      await sendPlainMessage("⚠️ Pipeline failed — check logs");
    } catch {
      // Swallow — best effort
    }
    process.exit(1);
  });

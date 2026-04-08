import OpenAI from "openai";
import { createLogger } from "./logger";
import {
  getRecentArticles,
  getSources,
  markEmailed,
  getPreferences,
  saveDigestArchive,
  logSystemEvent,
} from "./memory";
import { createSmtpTransport } from "./smtp";
import { getTopArticles, extractEmergingTopics } from "./scoring";
import { formatDigestPlainText, sendDigestTelegram } from "./telegram_digest";
import {
  getDailyUsageReport,
  canMakeAICall,
  recordAICall,
} from "./usage_limiter";
import type { ArticleHistory, SourceRegistry, UsageReport } from "./types";

const logger = createLogger("send_email");

// ── Transporter ──

function createTransport() {
  const t = createSmtpTransport();
  if (!t) {
    logger.warn("Email SMTP not configured — digest email channel skipped");
  }
  return t;
}

/** True if we can send digest email (SMTP + from + to). */
function digestEmailConfigured(): boolean {
  if (!createSmtpTransport()) return false;
  const from = (
    process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER || process.env.SMTP_USER || ""
  ).trim();
  const to = (process.env.EMAIL_TO || "").trim();
  return Boolean(from && to);
}

/** True if digest Telegram is enabled and token + chat id are set. */
function digestTelegramConfigured(): boolean {
  const skipTg =
    process.env.SEND_DIGEST_TELEGRAM === "false" ||
    process.env.SEND_DIGEST_TELEGRAM === "0";
  if (skipTg) return false;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return Boolean(token && chatId);
}

// ── AI Insight ──

async function generateInsight(
  articles: ArticleHistory[],
  interests: string[]
): Promise<string | null> {
  try {
    const morningDigest =
      process.env.MORNING_DIGEST_RUN === "true" ||
      process.argv.includes("--daily");

    if (!morningDigest) {
      const allowed = await canMakeAICall();
      if (!allowed) {
        logger.info("No budget for daily insight");
        return null;
      }
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const openai = new OpenAI({ apiKey });
    const summaries = articles
      .filter((a) => a.summary)
      .map((a) => `- ${a.title}: ${a.summary}`)
      .slice(0, 5)
      .join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Based on today's top articles, write a 2-sentence strategic insight for someone interested in: ${interests.join(", ") || "general news"}. Be specific, not generic.`,
        },
        { role: "user", content: `Today's articles:\n${summaries}` },
      ],
      temperature: 0.5,
      max_tokens: 200,
    });

    const insight = response.choices[0]?.message?.content?.trim() ?? null;
    if (insight) {
      await recordAICall();
      logger.info(
        morningDigest
          ? "Morning digest insight generated (single AI call)"
          : "Daily insight generated"
      );
    }
    return insight;
  } catch (err) {
    logger.error("Insight generation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── HTML Template ──

function articleRow(article: ArticleHistory, rank: number): string {
  const score = article.importance_score
    ? `<span style="color:#2563eb;font-weight:bold">${article.importance_score}/10</span>`
    : '<span style="color:#94a3b8">unscored</span>';

  return `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:2px">#${rank} · ${escapeHtml(article.source)}</div>
        <a href="${escapeHtml(article.url)}" style="color:#1e293b;font-weight:600;text-decoration:none;font-size:15px">
          ${escapeHtml(article.title)}
        </a>
        ${article.summary ? `<div style="color:#475569;font-size:13px;margin-top:4px">${escapeHtml(article.summary)}</div>` : ""}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;text-align:center;vertical-align:top;white-space:nowrap">
        ${score}
      </td>
    </tr>`;
}

function buildHtml(
  topArticles: ArticleHistory[],
  topics: Map<string, number>,
  usage: UsageReport,
  insight: string | null,
  bestSource: SourceRegistry | null
): string {
  const articleRows = topArticles
    .map((a, i) => articleRow(a, i + 1))
    .join("");

  const topicBadges = [...topics.entries()]
    .map(
      ([t, c]) =>
        `<span style="display:inline-block;background:#e0f2fe;color:#0369a1;padding:3px 10px;border-radius:12px;font-size:12px;margin:2px">${escapeHtml(t)} (${c})</span>`
    )
    .join(" ");

  const insightBlock = insight
    ? `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;margin:16px 0;border-radius:4px">
        <div style="font-weight:600;color:#166534;margin-bottom:4px">💡 AI Insight</div>
        <div style="color:#15803d;font-size:14px">${escapeHtml(insight)}</div>
      </div>`
    : "";

  const sourceBlock = bestSource
    ? `<div style="font-size:13px;color:#64748b;margin-top:12px">⭐ Source of the day: <strong>${escapeHtml(bestSource.name)}</strong> (trust: ${bestSource.trust_score}/10)</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

  <div style="background:#0f172a;color:#ffffff;padding:24px 20px">
    <div style="font-size:20px;font-weight:700">📡 Intelligence Digest</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:4px">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
  </div>

  <div style="padding:20px">
    <div style="font-size:12px;color:#64748b;background:#f1f5f9;padding:8px 12px;border-radius:6px;margin-bottom:16px">
      🔋 AI Budget: <strong>${usage.callsUsed}/${usage.maxCalls}</strong> calls used today · ${usage.callsRemaining} remaining
    </div>

    ${insightBlock}

    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px 16px;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0">TOP STORIES</th>
          <th style="text-align:center;padding:8px 16px;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0">SCORE</th>
        </tr>
      </thead>
      <tbody>
        ${articleRows || '<tr><td colspan="2" style="padding:20px;text-align:center;color:#94a3b8">No articles processed today</td></tr>'}
      </tbody>
    </table>

    ${topicBadges ? `<div style="margin-top:20px"><div style="font-size:12px;color:#64748b;margin-bottom:6px;font-weight:600">EMERGING TOPICS</div>${topicBadges}</div>` : ""}

    ${sourceBlock}
  </div>

  <div style="background:#f8fafc;padding:16px 20px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0">
    Jeff Intelligence System · Automated daily digest
  </div>

</div>
</body>
</html>`;
}

function buildPlainText(
  topArticles: ArticleHistory[],
  usage: UsageReport,
  insight: string | null
): string {
  const lines = [
    "=== INTELLIGENCE DIGEST ===",
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `AI Budget: ${usage.callsUsed}/${usage.maxCalls} calls used`,
    "",
  ];

  if (insight) {
    lines.push(`INSIGHT: ${insight}`, "");
  }

  lines.push("TOP STORIES:");
  if (topArticles.length === 0) {
    lines.push("  No articles processed today");
  }
  for (const [i, a] of topArticles.entries()) {
    lines.push(`  ${i + 1}. ${a.title}`);
    if (a.summary) lines.push(`     ${a.summary}`);
    lines.push(`     Score: ${a.importance_score ?? "n/a"}/10 | ${a.url}`);
    lines.push("");
  }

  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Main export ──

export async function sendDailyDigest(
  interests: string[] = []
): Promise<boolean> {
  try {
    logger.info("Building daily digest");

    if (!digestEmailConfigured() && !digestTelegramConfigured()) {
      logger.error(
        "No digest delivery configured: GitHub Actions needs repository secrets for SMTP (EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_TO, EMAIL_FROM optional) and/or Telegram (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID). If you use Environment secrets, add `environment: …` to the workflow job."
      );
      await logSystemEvent({
        level: "error",
        source: "digest",
        message: "Daily digest skipped: no SMTP or Telegram secrets in runner env",
      });
      return false;
    }

    const userId = process.env.TELEGRAM_CHAT_ID ?? "default";
    let effectiveInterests = interests;
    if (effectiveInterests.length === 0) {
      try {
        const prefs = await getPreferences(userId);
        effectiveInterests = prefs.interests;
      } catch {
        /* use [] */
      }
    }

    const [recentArticles, sources, usage] = await Promise.all([
      getRecentArticles(24),
      getSources(),
      getDailyUsageReport(),
    ]);

    const topForEmail = getTopArticles(recentArticles, 3);
    const topForTelegram = getTopArticles(recentArticles, 6);
    const topics = extractEmergingTopics(recentArticles);
    const bestSource =
      sources.length > 0
        ? sources.reduce((a, b) =>
            a.trust_score >= b.trust_score ? a : b
          )
        : null;

    const insight = await generateInsight(
      recentArticles,
      effectiveInterests
    );

    const html = buildHtml(
      topForEmail,
      topics,
      usage,
      insight,
      bestSource
    );
    const text = buildPlainText(topForEmail, usage, insight);

    const transport = createTransport();
    let emailOk = false;
    if (transport) {
      const from = (
        process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER || process.env.SMTP_USER || ""
      ).trim();
      const to = (process.env.EMAIL_TO || "").trim();
      if (from && to) {
        await transport.sendMail({
          from,
          to,
          subject: `📡 Intelligence Digest — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          html,
          text,
        });
        const emailedUrls = topForEmail.map((a) => a.url);
        await markEmailed(emailedUrls);
        logger.info("Daily digest email sent", {
          to,
          articles: topForEmail.length,
        });
        emailOk = true;
      } else {
        logger.warn("EMAIL_FROM or EMAIL_TO missing — skipping email");
      }
    } else {
      logger.warn("No email SMTP — skipping email channel");
    }

    const skipTg =
      process.env.SEND_DIGEST_TELEGRAM === "false" ||
      process.env.SEND_DIGEST_TELEGRAM === "0";
    let telegramOk = false;
    if (!skipTg) {
      try {
        const plain = formatDigestPlainText(topForTelegram, usage, insight);
        telegramOk = await sendDigestTelegram(plain);
        if (emailOk && !telegramOk) {
          logger.warn(
            "Digest email was sent; Telegram did not send (check token, chat id, or set SEND_DIGEST_TELEGRAM=false to skip). The bot does not need to be 'running' for API delivery."
          );
        }
      } catch (err) {
        logger.warn("Telegram digest threw (email still counts if it already sent)", {
          error: err instanceof Error ? err.message : String(err),
        });
        telegramOk = false;
      }
    }

    if (!emailOk && !telegramOk) {
      logger.error("Digest had no delivery channel (configure SMTP and/or Telegram)");
      await logSystemEvent({
        level: "error",
        source: "digest",
        message: "Daily digest had no delivery channel",
      });
      return false;
    }

    const channels: string[] = [];
    if (emailOk) channels.push("email");
    if (telegramOk) channels.push("telegram");

    const urls = [
      ...new Set([
        ...topForEmail.map((a) => a.url),
        ...topForTelegram.map((a) => a.url),
      ]),
    ];

    const combinedPlain = [
      formatDigestPlainText(topForTelegram, usage, insight),
      emailOk ? "\n---\n(HTML email also sent to inbox.)" : "",
    ].join("");

    await saveDigestArchive({
      channels,
      subject: emailOk
        ? `Intelligence Digest — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : `Intelligence Digest (Telegram) — ${new Date().toISOString().slice(0, 10)}`,
      html_body: emailOk ? html : null,
      plain_text: combinedPlain.slice(0, 120_000),
      article_urls: urls,
      meta: {
        email_ok: emailOk,
        telegram_ok: telegramOk,
        insight_present: Boolean(insight),
      },
    });

    await logSystemEvent({
      level: "info",
      source: "digest",
      message: `Digest delivered via ${channels.join(" + ")}`,
      meta: { article_count: urls.length },
    });

    if (emailOk) {
      logger.info("Morning digest finished successfully (email is authoritative if present).");
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Daily digest failed", { error: msg });
    await logSystemEvent({
      level: "error",
      source: "digest",
      message: `Daily digest failed: ${msg}`,
    });
    return false;
  }
}

// ── CLI entry point for GitHub Actions ──
if (process.argv.includes("--daily")) {
  sendDailyDigest()
    .then((ok) => {
      if (!ok) {
        logger.error(
          "Morning digest failed: nothing was delivered. For email, set Actions secrets EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_TO (and EMAIL_FROM if needed). Telegram failures do not fail the job if email succeeds."
        );
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      logger.error("Digest crashed", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}

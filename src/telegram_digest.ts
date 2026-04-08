import { createLogger } from "./logger";
import type { ArticleHistory, UsageReport } from "./types";

const logger = createLogger("telegram_digest");

const TG_MAX = 3900;

export function formatDigestPlainText(
  topArticles: ArticleHistory[],
  usage: UsageReport,
  insight: string | null
): string {
  const lines: string[] = [
    `📡 Morning briefing — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`,
    "",
    `AI budget today: ${usage.callsUsed}/${usage.maxCalls} used`,
    "",
  ];

  if (insight) {
    lines.push(`💡 ${insight}`, "");
  }

  lines.push("Top stories", "────────────");
  if (topArticles.length === 0) {
    lines.push(
      "(No scored articles in the last 24h — the pipeline may still be collecting.)"
    );
  } else {
    for (const [i, a] of topArticles.entries()) {
      const score =
        a.importance_score != null ? ` [${a.importance_score}/10]` : "";
      lines.push(`${i + 1}. ${a.title}${score}`);
      if (a.summary) {
        const s =
          a.summary.length > 280 ? a.summary.slice(0, 277) + "…" : a.summary;
        lines.push(`   ${s}`);
      }
      lines.push(`   ${a.url}`);
      lines.push("");
    }
  }

  let text = lines.join("\n");
  if (text.length > TG_MAX) {
    text = text.slice(0, TG_MAX - 24) + "\n…(truncated)";
  }
  return text;
}

export async function sendDigestTelegram(plainText: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatIdRaw = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatIdRaw) {
    logger.warn("Telegram not configured — skipping digest message");
    return false;
  }

  // String chat_id avoids JS Number precision loss on large Telegram ids.
  const payload = JSON.stringify({
    chat_id: chatIdRaw,
    text: plainText,
  });

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }
    );
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!body.ok) {
      logger.error("Telegram digest failed", {
        description: body.description,
        hint: "Use your numeric user id from getUpdates; for groups start the bot in the group first",
      });
      return false;
    }
    logger.info("Morning briefing sent to Telegram");
    return true;
  } catch (err) {
    logger.error("Telegram digest request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

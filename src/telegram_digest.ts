import { createLogger } from "./logger";
import type { ArticleHistory, UsageReport } from "./types";
import type { EconomicEvent, MarketQuote, WeatherData } from "./data_feeds";

const logger = createLogger("telegram_digest");

const TG_MAX = 3900;

interface DigestTelegramExtras {
  mode?: "daily" | "weekly";
  weather?: WeatherData | null;
  marketSnapshot?: MarketQuote[];
  economicCalendar?: EconomicEvent[];
  dailyFact?: string | null;
}

export function formatDigestPlainText(
  topArticles: ArticleHistory[],
  usage: UsageReport,
  insight: string | null,
  extras: DigestTelegramExtras = {}
): string {
  const mode = extras.mode ?? "daily";
  const weather = extras.weather ?? null;
  const marketSnapshot = extras.marketSnapshot ?? [];
  const economicCalendar = extras.economicCalendar ?? [];
  const dailyFact = extras.dailyFact ?? null;
  const lines: string[] = [
    `📡 ${
      mode === "weekly" ? "Weekly briefing" : "Morning briefing"
    } — ${new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`,
    "",
    `AI budget today: ${usage.callsUsed}/${usage.maxCalls} used`,
    "",
  ];

  if (weather) {
    lines.push(
      `Denver: ${weather.emoji} ${weather.condition}, ${weather.temp}°F (H:${weather.high}° L:${weather.low}°)`,
      ""
    );
  }

  if (marketSnapshot.length > 0) {
    const marketLine = marketSnapshot
      .map((q) => {
        const sign = (q.changePercent ?? 0) >= 0 ? "+" : "";
        const pct =
          q.changePercent == null
            ? "n/a"
            : `${sign}${q.changePercent.toFixed(2)}%`;
        return `${q.label} ${pct}`;
      })
      .join(" | ");
    lines.push(`Markets: ${marketLine}`, "");
  }

  if (economicCalendar.length > 0) {
    lines.push("What to watch today:");
    for (const event of economicCalendar.slice(0, 3)) {
      const impact =
        event.impact === "high"
          ? "HIGH"
          : event.impact === "medium"
          ? "MEDIUM"
          : event.impact === "low"
          ? "LOW"
          : "INFO";
      lines.push(
        `  - ${event.timeLabel} ${event.country} ${event.event} [${impact}]`
      );
    }
    lines.push("");
  }

  if (insight) {
    lines.push(`💡 ${insight}`, "");
  }

  if (dailyFact) {
    lines.push(`Fact: ${dailyFact}`, "");
  }

  lines.push("Top stories", "────────────");
  if (topArticles.length === 0) {
    lines.push(
      mode === "weekly"
        ? "(No scored articles in the last 7 days — the pipeline may still be collecting.)"
        : "(No scored articles in the last 24h — the pipeline may still be collecting.)"
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

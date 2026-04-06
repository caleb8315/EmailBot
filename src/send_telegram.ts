import https from "https";
import { createLogger } from "./logger";
import { getLastAlertTime, markAlerted } from "./memory";
import { shouldAlert } from "./scoring";
import type { ArticleHistory } from "./types";

const logger = createLogger("send_telegram");

const ALERT_COOLDOWN_HOURS = parseInt(
  process.env.ALERT_COOLDOWN_HOURS ?? "2",
  10
);

function getConfig(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    logger.warn("Telegram credentials not configured");
    return null;
  }
  return { token, chatId };
}

function sentimentEmoji(score: number | null): string {
  if (score === null) return "📰";
  if (score >= 9) return "🚨";
  if (score >= 7) return "⚡";
  return "📰";
}

function formatAlertMessage(article: ArticleHistory): string {
  const emoji = sentimentEmoji(article.importance_score);
  const lines = [
    `${emoji} *${escapeMarkdown(article.title)}*`,
    "",
    article.summary ? escapeMarkdown(article.summary) : "",
    "",
    article.importance_score
      ? `📊 Importance: ${article.importance_score}/10`
      : "",
    "",
    `🔗 [Read more](${article.url})`,
    `📡 Source: ${escapeMarkdown(article.source)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  parseMode: string = "MarkdownV2"
): Promise<boolean> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: false,
    });

    const options = {
      hostname: "api.telegram.org",
      path: `/bot${token}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          logger.error("Telegram API error", {
            status: res.statusCode,
            body: body.slice(0, 300),
          });
          resolve(false);
        }
      });
    });

    req.on("error", (err) => {
      logger.error("Telegram request failed", { error: err.message });
      resolve(false);
    });

    req.setTimeout(10000, () => {
      logger.error("Telegram request timed out");
      req.destroy();
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

async function isCooldownActive(): Promise<boolean> {
  try {
    const lastAlert = await getLastAlertTime();
    if (!lastAlert) return false;

    const hoursSince =
      (Date.now() - lastAlert.getTime()) / (1000 * 60 * 60);
    const active = hoursSince < ALERT_COOLDOWN_HOURS;

    if (active) {
      logger.info("Alert cooldown active", {
        hoursSince: hoursSince.toFixed(1),
        cooldownHours: ALERT_COOLDOWN_HOURS,
      });
    }

    return active;
  } catch (err) {
    logger.error("Cooldown check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function sendAlertIfNeeded(
  article: ArticleHistory
): Promise<boolean> {
  try {
    if (!shouldAlert(article)) {
      logger.debug("Article below alert threshold", {
        title: article.title.slice(0, 60),
        importance: article.importance_score,
        credibility: article.credibility_score,
      });
      return false;
    }

    const config = getConfig();
    if (!config) return false;

    if (await isCooldownActive()) return false;

    const message = formatAlertMessage(article);
    const sent = await sendTelegramMessage(
      config.token,
      config.chatId,
      message
    );

    if (sent) {
      await markAlerted(article.url);
      logger.info("Alert sent", { title: article.title.slice(0, 60) });
    }

    return sent;
  } catch (err) {
    logger.error("sendAlertIfNeeded failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function sendPlainMessage(text: string): Promise<boolean> {
  try {
    const config = getConfig();
    if (!config) return false;
    return await sendTelegramMessage(config.token, config.chatId, text, "");
  } catch (err) {
    logger.error("sendPlainMessage failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

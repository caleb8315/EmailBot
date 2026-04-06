import https from "https";
import http from "http";
import OpenAI from "openai";
import { createLogger } from "./logger";
import {
  getPreferences,
  updatePreferences,
  getLastAlertedArticle,
} from "./memory";
import {
  canMakeAICall,
  recordAICall,
  getDailyUsageReport,
} from "./usage_limiter";
import { ParsedIntentSchema } from "./types";
import type { ChatIntent, ParsedIntent, UserPreferences } from "./types";

const logger = createLogger("chat_handler");

// ── Intent Parsing (regex first, then AI fallback) ──

const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: ChatIntent }> = [
  { pattern: /^help$/i, intent: "help" },
  { pattern: /^status$/i, intent: "status" },
  { pattern: /^why\b/i, intent: "why" },
  { pattern: /\b(analyze|deeper|detail)\b/i, intent: "deeper" },
  {
    pattern: /\b(focus|prioritize|more)\b.*\b(on|about)\b/i,
    intent: "focus",
  },
  { pattern: /\b(ignore|stop|hide|block|mute)\b/i, intent: "ignore" },
];

function extractTopic(message: string): string {
  const cleaned = message
    .replace(
      /\b(focus|prioritize|more|on|about|ignore|stop|hide|block|mute)\b/gi,
      ""
    )
    .trim();
  return cleaned || "general";
}

function parseIntentWithRegex(message: string): ParsedIntent | null {
  const trimmed = message.trim();
  for (const { pattern, intent } of INTENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        intent,
        topic: extractTopic(trimmed),
        confidence: 0.9,
      };
    }
  }
  return null;
}

async function parseIntentWithAI(
  message: string
): Promise<ParsedIntent | null> {
  try {
    const allowed = await canMakeAICall();
    if (!allowed) {
      logger.info("No AI budget for intent parsing");
      return null;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            'Parse the user\'s message and return JSON: { "intent": string, "topic": string, "confidence": number }. Intents: focus | ignore | why | deeper | status | help | unknown.',
        },
        { role: "user", content: message },
      ],
      temperature: 0.1,
      max_tokens: 100,
    });

    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const validated = ParsedIntentSchema.parse(parsed);

    await recordAICall();
    logger.info("Intent parsed via AI", { intent: validated.intent });
    return validated;
  } catch (err) {
    logger.error("AI intent parsing failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Intent Handlers ──

async function handleFocus(
  userId: string,
  topic: string
): Promise<string> {
  try {
    const prefs = await getPreferences(userId);
    const interests = [...new Set([...prefs.interests, topic])];
    await updatePreferences(userId, { interests });
    return `Got it — I'll prioritize "${topic}" news going forward.`;
  } catch (err) {
    logger.error("handleFocus failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Sorry, I couldn't update your preferences right now.";
  }
}

async function handleIgnore(
  userId: string,
  topic: string
): Promise<string> {
  try {
    const prefs = await getPreferences(userId);
    const dislikes = [...new Set([...prefs.dislikes, topic])];
    await updatePreferences(userId, { dislikes });
    return `Got it — I'll filter out "${topic}" from your feed.`;
  } catch (err) {
    logger.error("handleIgnore failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Sorry, I couldn't update your preferences right now.";
  }
}

async function handleWhy(): Promise<string> {
  try {
    const article = await getLastAlertedArticle();
    if (!article) {
      return "No recent alerts to explain.";
    }
    const lines = [
      `📰 *${article.title}*`,
      "",
      article.summary ?? "No summary available.",
      "",
      `Importance: ${article.importance_score ?? "n/a"}/10`,
      `Credibility: ${article.credibility_score ?? "n/a"}/10`,
    ];
    return lines.join("\n");
  } catch (err) {
    logger.error("handleWhy failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Sorry, I couldn't fetch the article details.";
  }
}

async function handleStatus(): Promise<string> {
  try {
    const report = await getDailyUsageReport();
    return [
      "📊 *System Status*",
      "",
      `AI Budget: ${report.callsUsed}/${report.maxCalls} calls used`,
      `Remaining: ${report.callsRemaining} calls`,
      `Date: ${report.date}`,
    ].join("\n");
  } catch (err) {
    logger.error("handleStatus failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Sorry, I couldn't fetch the status right now.";
  }
}

function handleHelp(): string {
  return [
    "🤖 *Available Commands*",
    "",
    '• "focus on AI startups" — prioritize a topic',
    '• "ignore crypto" — filter out a topic',
    '• "why" — explain the last alert',
    '• "deeper" — re-analyze with more detail (uses AI budget)',
    '• "status" — see today\'s AI budget usage',
    '• "help" — show this message',
  ].join("\n");
}

async function handleDeeper(userId: string): Promise<string> {
  try {
    const allowed = await canMakeAICall();
    if (!allowed) {
      return "No AI budget remaining today for deeper analysis.";
    }

    const article = await getLastAlertedArticle();
    if (!article) {
      return "No recent article to analyze deeper.";
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return "OpenAI not configured.";

    const prefs = await getPreferences(userId);
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Provide a detailed 3-4 sentence analysis of this article. Focus on implications, context, and what to watch for next.",
        },
        {
          role: "user",
          content: `Title: ${article.title}\nSource: ${article.source}\nSummary: ${article.summary ?? "N/A"}\n\nUser interests: ${prefs.interests.join(", ") || "general"}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 300,
    });

    await recordAICall();
    const analysis = response.choices[0]?.message?.content?.trim();
    return analysis
      ? `🔍 *Deep Analysis*\n\n${analysis}`
      : "Could not generate deeper analysis.";
  } catch (err) {
    logger.error("handleDeeper failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Sorry, the deeper analysis failed.";
  }
}

// ── Main Message Router ──

export async function handleMessage(
  userId: string,
  message: string
): Promise<string> {
  try {
    logger.info("Handling message", {
      userId,
      message: message.slice(0, 100),
    });

    let parsed = parseIntentWithRegex(message);

    if (!parsed) {
      parsed = await parseIntentWithAI(message);
    }

    if (!parsed || parsed.intent === "unknown") {
      return handleHelp();
    }

    switch (parsed.intent) {
      case "focus":
        return handleFocus(userId, parsed.topic);
      case "ignore":
        return handleIgnore(userId, parsed.topic);
      case "why":
        return handleWhy();
      case "deeper":
        return handleDeeper(userId);
      case "status":
        return handleStatus();
      case "help":
        return handleHelp();
      default:
        return handleHelp();
    }
  } catch (err) {
    logger.error("handleMessage failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Sorry, something went wrong. Try again or type 'help'.";
  }
}

// ── Telegram Webhook Listener (CLI entry point) ──

function sendTelegramReply(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "",
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

    const req = https.request(options, () => resolve());
    req.on("error", (err) => {
      logger.error("Reply send failed", { error: err.message });
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

if (process.argv.includes("--listen")) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.error("TELEGRAM_BOT_TOKEN required for --listen mode");
    process.exit(1);
  }

  let lastUpdateId = 0;

  async function pollUpdates(): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
      const response = await fetch(url);
      const data = (await response.json()) as {
        ok: boolean;
        result: Array<{
          update_id: number;
          message?: { chat: { id: number }; from?: { id: number }; text?: string };
        }>;
      };

      if (data.ok && data.result) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          const msg = update.message;
          if (msg?.text) {
            const userId = String(msg.from?.id ?? msg.chat.id);
            const reply = await handleMessage(userId, msg.text);
            await sendTelegramReply(token!, msg.chat.id, reply);
          }
        }
      }
    } catch (err) {
      logger.error("Poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Starting Telegram polling");
  const poll = async () => {
    while (true) {
      await pollUpdates();
    }
  };
  poll().catch(() => process.exit(1));
}

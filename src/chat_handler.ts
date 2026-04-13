import https from "https";
import { createClient } from "@supabase/supabase-js";
import { createLogger } from "./logger";
import {
  getPreferences,
  updatePreferences,
  patchBriefingOverlay,
} from "./memory";
import { getDailyUsageReport } from "./usage_limiter";
import { runBriefingAssistant } from "./ai_conversation";
import { fetchDenverWeather, fetchMarketSnapshot } from "./data_feeds";
import type { UserPreferences } from "./types";
import { BRIEFING_SECTIONS } from "./types";
import { matchBriefingSection } from "./briefing_helpers";

const logger = createLogger("chat_handler");

function isAllowedChat(chatId: number): boolean {
  const multi = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi && multi.length > 0) {
    return multi.includes(String(chatId));
  }
  const single = process.env.TELEGRAM_CHAT_ID?.trim();
  if (single) {
    return String(chatId) === single;
  }
  return true;
}

// ── Slash commands (deterministic shortcuts) ───────────────────

async function handleSlashCommand(
  userId: string,
  chatId: number,
  text: string
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  if (!isAllowedChat(chatId)) {
    return "This bot is restricted to your configured chat.";
  }

  const body = trimmed.slice(1).trim();
  const [cmd0, ...rest] = body.split(/\s+/);
  const cmd = cmd0.toLowerCase();
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "start":
      return [
        "Welcome — I'm your AI briefing assistant.",
        "",
        "Ask me anything about recent stories (including what showed up in your digest), or say things like “focus more on Taiwan” or “why does story 3 matter?”.",
        "",
        "I use one shared AI budget with the news pipeline — /status shows what's left.",
        "/help lists slash shortcuts.",
      ].join("\n");
    case "help":
      return handleHelp();
    case "prefs":
      return formatPrefsSummary(await getPreferences(userId));
    case "status": {
      const report = await getDailyUsageReport();
      return [
        "AI budget (shared: chat + pipeline + digest insight)",
        "",
        `${report.callsUsed}/${report.maxCalls} used today`,
        `${report.callsRemaining} remaining`,
        "",
        `Chat budget: ${report.chatCallsUsed}/${report.maxChatCalls} used`,
        `${report.chatCallsRemaining} chat requests remaining`,
        `Date (UTC): ${report.date}`,
      ].join("\n");
    }
    case "weather": {
      const weather = await fetchDenverWeather();
      if (!weather) {
        return "Weather feed is unavailable right now. Try again in a few minutes.";
      }
      return [
        "Denver weather",
        "",
        `${weather.emoji} ${weather.condition}, ${weather.temp}°F`,
        `Feels like ${weather.feelsLike}°F`,
        `High ${weather.high}° / Low ${weather.low}°`,
        `Wind ${weather.wind} mph · Precip ${weather.precipChance}%`,
      ].join("\n");
    }
    case "markets": {
      const quotes = await fetchMarketSnapshot();
      if (quotes.length === 0) {
        return "Market feed is unavailable right now. Try again in a few minutes.";
      }
      const lines = quotes.map((q) => {
        const sign = (q.changePercent ?? 0) >= 0 ? "+" : "";
        const pct =
          q.changePercent == null
            ? "n/a"
            : `${sign}${q.changePercent.toFixed(2)}%`;
        return `${q.label}: ${q.price.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })} (${pct})`;
      });
      return ["Market snapshot", "", ...lines].join("\n");
    }
    case "boost": {
      const cat = matchBriefingSection(arg);
      if (!cat) {
        return `Give a section name, e.g. /boost AI   Sections: ${BRIEFING_SECTIONS.join(", ")}`;
      }
      await patchBriefingOverlay(userId, (prev) => {
        const boost = new Set(prev.boost_categories ?? []);
        boost.add(cat);
        const ign = new Set(prev.ignore_categories ?? []);
        ign.delete(cat);
        return {
          ...prev,
          boost_categories: [...boost],
          ignore_categories: [...ign],
        };
      });
      return `Boosted "${cat}" for briefing priority.`;
    }
    case "mute":
    case "ignoresection": {
      const cat = matchBriefingSection(arg);
      if (!cat) {
        return `Which section? e.g. /mute Crypto`;
      }
      await patchBriefingOverlay(userId, (prev) => {
        const ign = new Set(prev.ignore_categories ?? []);
        ign.add(cat);
        const boost = new Set(prev.boost_categories ?? []);
        boost.delete(cat);
        return {
          ...prev,
          ignore_categories: [...ign],
          boost_categories: [...boost],
        };
      });
      return `Muted "${cat}" in the Python briefing ranking (weight min).`;
    }
    case "alert": {
      const n = parseInt(arg, 10);
      if (Number.isNaN(n) || n < 1 || n > 10) {
        return "Usage: /alert 7  (1 = only extreme, 10 = more alerts)";
      }
      await updatePreferences(userId, { alert_sensitivity: n });
      return `Alert sensitivity set to ${n}/10.`;
    }
    case "keyword": {
      const parts = arg.split(/\s+/).filter(Boolean);
      const op = parts[0]?.toLowerCase();
      const word = parts.slice(1).join(" ").trim();
      if (!word || (op !== "add" && op !== "remove")) {
        return "Usage: /keyword add tariff   or   /keyword remove bitcoin";
      }
      if (op === "add") {
        await patchBriefingOverlay(userId, (prev) => {
          const k = new Set(prev.tier1_keywords ?? []);
          k.add(word.toLowerCase());
          return { ...prev, tier1_keywords: [...k] };
        });
        return `Added breaking keyword: ${word}`;
      }
      await patchBriefingOverlay(userId, (prev) => ({
        ...prev,
        tier1_keywords: (prev.tier1_keywords ?? []).filter(
          (x) => x.toLowerCase() !== word.toLowerCase()
        ),
      }));
      return `Removed keyword: ${word}`;
    }
    case "believe": {
      if (!arg) return "Usage: /believe <your belief>\nExample: /believe China will invade Taiwan before 2028";
      const sb = getIntelSupabase();
      if (!sb) return "Intel database not configured.";
      const { error } = await sb.from("user_beliefs").insert({
        statement: arg,
        confidence: 0.5,
        source: "stated",
        conversation_context: `Telegram /believe command`,
        status: "active",
        tags: [],
      });
      if (error) return `Failed to save belief: ${error.message}`;
      return `Belief recorded: "${arg}"\nConfidence set to 50% (default). Jeff will track evidence for and against.`;
    }
    case "predict": {
      if (!arg) return "Usage: /predict <prediction>\nExample: /predict Russia will launch an offensive in Kharkiv by June 2026";
      const parts = arg.split("|").map(s => s.trim());
      const statement = parts[0];
      const confidence = parts[1] ? parseFloat(parts[1]) / 100 : 0.5;
      const resolveBy = parts[2] || null;
      const sb = getIntelSupabase();
      if (!sb) return "Intel database not configured.";
      const { error } = await sb.from("predictions").insert({
        predictor: "user",
        statement,
        confidence_at_prediction: Math.max(0.02, Math.min(0.98, confidence)),
        resolve_by: resolveBy ? new Date(resolveBy).toISOString() : null,
        tags: [],
        confidence_history: [{ timestamp: new Date().toISOString(), confidence, reason: "initial prediction via Telegram" }],
      });
      if (error) return `Failed to save prediction: ${error.message}`;
      return `Prediction logged: "${statement}"\nYour confidence: ${Math.round(confidence * 100)}%${resolveBy ? `\nResolves by: ${resolveBy}` : ""}\n\nTip: /predict <statement> | <confidence%> | <resolve date>`;
    }
    case "calibration": {
      const sb = getIntelSupabase();
      if (!sb) return "Intel database not configured.";
      const { data: profile } = await sb.from("user_profile").select("*").limit(1).single();
      const { data: resolved } = await sb.from("predictions").select("predictor, outcome, brier_score").not("outcome", "is", null);
      if (!profile && (!resolved || resolved.length === 0)) return "No predictions resolved yet. Log predictions with /predict and they'll be scored when they resolve.";
      const total = profile?.total_predictions || 0;
      const correct = profile?.correct_predictions || 0;
      const score = profile?.calibration_score;
      let userBrier = 0, jeffBrier = 0, userCount = 0, jeffCount = 0;
      for (const p of resolved || []) {
        if (p.predictor === "user" && p.brier_score != null) { userBrier += p.brier_score; userCount++; }
        if (p.predictor === "jeff" && p.brier_score != null) { jeffBrier += p.brier_score; jeffCount++; }
      }
      return [
        "📊 CALIBRATION REPORT",
        `Total predictions: ${total}`,
        `Correct: ${correct}`,
        score != null ? `Calibration score: ${(score * 100).toFixed(0)}%` : "",
        userCount > 0 ? `Your Brier score: ${(userBrier / userCount).toFixed(3)} (lower = better)` : "",
        jeffCount > 0 ? `Jeff's Brier score: ${(jeffBrier / jeffCount).toFixed(3)}` : "",
        "",
        "Log predictions: /predict <statement> | <confidence%> | <date>",
      ].filter(Boolean).join("\n");
    }
    case "beliefs": {
      const sb = getIntelSupabase();
      if (!sb) return "Intel database not configured.";
      const { data } = await sb.from("beliefs").select("statement, confidence, jeff_stake").eq("status", "active").order("confidence", { ascending: false }).limit(10);
      if (!data || data.length === 0) return "No active beliefs.";
      return "🧠 JEFF'S TOP BELIEFS\n\n" + data.map((b: { statement: string; confidence: number; jeff_stake: string }) =>
        `${Math.round(b.confidence * 100)}% — ${b.statement.slice(0, 80)}${b.statement.length > 80 ? "..." : ""}`
      ).join("\n\n");
    }
    case "arcs": {
      const sb = getIntelSupabase();
      if (!sb) return "Intel database not configured.";
      const { data } = await sb.from("narrative_arcs").select("title, current_act, total_acts, next_act_predicted").eq("status", "active").order("last_updated", { ascending: false }).limit(5);
      if (!data || data.length === 0) return "No active narrative arcs.";
      return "📖 ACTIVE NARRATIVE ARCS\n\n" + data.map((a: { title: string; current_act: number; total_acts: number; next_act_predicted: string }) =>
        `Act ${a.current_act}/${a.total_acts || "?"} — ${a.title}${a.next_act_predicted ? `\n   Next: ${a.next_act_predicted}` : ""}`
      ).join("\n\n");
    }
    default:
      return `Unknown command /${cmd}. Send /help.`;
  }
}

function getIntelSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function formatPrefsSummary(p: UserPreferences): string {
  const o = p.briefing_overlay ?? {};
  return [
    "Your preferences",
    "",
    `Alert sensitivity: ${p.alert_sensitivity}/10`,
    `Interest boost (pipeline): ${p.interests.join(", ") || "—"}`,
    `Filtered topics: ${p.dislikes.join(", ") || "—"}`,
    "",
    "Briefing sections (Python digest)",
    `  Boosted: ${(o.boost_categories ?? []).join(", ") || "—"}`,
    `  Muted: ${(o.ignore_categories ?? []).join(", ") || "—"}`,
    `  Breaking keywords: ${(o.tier1_keywords ?? []).join(", ") || "defaults"}`,
  ].join("\n");
}

function handleHelp(): string {
  return [
    "Slash shortcuts",
    "",
    "/prefs — saved settings",
    "/status — AI budget today",
    "/weather — Denver weather now",
    "/markets — quick market snapshot",
    "/boost <section> — briefing emphasis",
    "/mute <section>",
    "/alert <1-10>",
    "/keyword add/remove <word>",
    "",
    "── Intelligence ──",
    "/beliefs — Jeff's top beliefs about the world",
    "/believe <statement> — record your own belief",
    "/predict <text> | <%> | <date> — log prediction",
    "/calibration — your prediction accuracy",
    "/arcs — active narrative arcs",
    "",
    "Everything else goes to the AI assistant:",
    "• Discuss any numbered story from your recent digest list",
    "• “What should I watch from story 2?”",
    "• “Focus more on semiconductors” / “less celebrity news”",
  ].join("\n");
}

// ── Main router ─────────────────────────────────────────────────

export async function handleMessage(
  userId: string,
  chatId: number,
  message: string
): Promise<string> {
  try {
    logger.info("Handling message", {
      userId,
      message: message.slice(0, 100),
    });

    const slashReply = await handleSlashCommand(userId, chatId, message);
    if (slashReply !== null) {
      return slashReply;
    }

    if (!isAllowedChat(chatId)) {
      return "This bot is restricted to your configured chat.";
    }

    return await runBriefingAssistant(userId, message);
  } catch (err) {
    logger.error("handleMessage failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Sorry, something went wrong. Try /help.";
  }
}

// ── Telegram long-polling (CLI) ─────────────────────────────────

function sendTelegramReply(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text,
    });

    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      () => resolve()
    );
    req.on("error", (err: Error) => {
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
  const botToken = token;

  let lastUpdateId = 0;

  async function pollUpdates(): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
      const response = await fetch(url);
      const data = (await response.json()) as {
        ok: boolean;
        result: Array<{
          update_id: number;
          message?: {
            chat: { id: number };
            from?: { id: number };
            text?: string;
          };
        }>;
      };

      if (data.ok && data.result) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          const msg = update.message;
          if (!msg) continue;
          const text = msg.text;
          if (!text) continue;
          const userId = String(msg.from?.id ?? msg.chat.id);
          const reply = await handleMessage(userId, msg.chat.id, text);
          await sendTelegramReply(botToken, msg.chat.id, reply);
        }
      }
    } catch (err) {
      logger.error("Poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Telegram bot polling (Ctrl+C to stop)");
  const poll = async () => {
    while (true) {
      await pollUpdates();
    }
  };
  poll().catch(() => process.exit(1));
}

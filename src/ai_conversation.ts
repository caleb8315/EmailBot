import OpenAI from "openai";
import { z } from "zod";
import { createLogger } from "./logger";
import {
  getPreferences,
  updatePreferences,
  patchBriefingOverlay,
  getRecentArticles,
  getLastAlertedArticle,
} from "./memory";
import { rankArticles } from "./scoring";
import { canMakeAICall, recordAICall } from "./usage_limiter";
import { matchBriefingSection } from "./briefing_helpers";
import { BRIEFING_SECTIONS } from "./types";
import type { ArticleHistory } from "./types";

const logger = createLogger("ai_conversation");

const TG_MAX = 4090;

const AssistantActionsSchema = z
  .object({
    add_interests: z.array(z.string()).optional(),
    remove_interests: z.array(z.string()).optional(),
    add_dislikes: z.array(z.string()).optional(),
    remove_dislikes: z.array(z.string()).optional(),
    alert_sensitivity: z.number().int().min(1).max(10).optional(),
    briefing_boost_sections: z.array(z.string()).optional(),
    briefing_mute_sections: z.array(z.string()).optional(),
    breaking_keywords_add: z.array(z.string()).optional(),
    breaking_keywords_remove: z.array(z.string()).optional(),
  })
  .optional();

const AssistantResponseSchema = z.object({
  reply: z.string(),
  actions: AssistantActionsSchema,
});

const AssistantResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    actions: {
      type: "object",
      additionalProperties: false,
      properties: {
        add_interests: { type: "array", items: { type: "string" } },
        remove_interests: { type: "array", items: { type: "string" } },
        add_dislikes: { type: "array", items: { type: "string" } },
        remove_dislikes: { type: "array", items: { type: "string" } },
        alert_sensitivity: { type: "integer", minimum: 1, maximum: 10 },
        briefing_boost_sections: { type: "array", items: { type: "string" } },
        briefing_mute_sections: { type: "array", items: { type: "string" } },
        breaking_keywords_add: { type: "array", items: { type: "string" } },
        breaking_keywords_remove: { type: "array", items: { type: "string" } },
      },
      required: [],
    },
  },
  required: ["reply"],
} as const;

function sortForBriefingContext(
  articles: ArticleHistory[],
  lastAlertUrl: string | null
): ArticleHistory[] {
  const ranked = rankArticles(articles);
  ranked.sort((a, b) => {
    if (a.emailed !== b.emailed) return a.emailed ? -1 : 1;
    const la = a.url === lastAlertUrl;
    const lb = b.url === lastAlertUrl;
    if (la !== lb) return la ? -1 : 1;
    const ia = a.importance_score ?? 0;
    const ib = b.importance_score ?? 0;
    return ib - ia;
  });
  return ranked;
}

function formatArticleBlock(
  articles: ArticleHistory[],
  lastAlertUrl: string | null
): string {
  if (articles.length === 0) {
    return "(No recent stories in the database yet. Run the pipeline or wait for the digest — then stories will appear here.)";
  }
  const lines: string[] = [];
  for (const [i, a] of articles.entries()) {
    const n = i + 1;
    const flags: string[] = [];
    if (a.emailed) flags.push("in_email_digest");
    if (a.alerted || a.url === lastAlertUrl) flags.push("recent_alert");
    const flagStr = flags.length ? ` [${flags.join(", ")}]` : "";
    const sum = a.summary
      ? a.summary.length > 320
        ? a.summary.slice(0, 317) + "…"
        : a.summary
      : "";
    lines.push(
      `${n}. ${a.title}${flagStr}`,
      `   source: ${a.source}`,
      sum ? `   summary: ${sum}` : "",
      `   url: ${a.url}`,
      `   scores: importance=${a.importance_score ?? "n/a"} credibility=${a.credibility_score ?? "n/a"}`
    );
    lines.push("");
  }
  return lines.filter(Boolean).join("\n");
}

async function applyActions(
  userId: string,
  actions: z.infer<typeof AssistantActionsSchema>
): Promise<void> {
  if (!actions || Object.keys(actions).length === 0) return;

  const prefs = await getPreferences(userId);
  let interests = [...prefs.interests];
  let dislikes = [...prefs.dislikes];

  for (const x of actions.remove_interests ?? []) {
    const xl = x.toLowerCase();
    interests = interests.filter((i) => i.toLowerCase() !== xl);
  }
  interests = [
    ...new Set([...interests, ...(actions.add_interests ?? [])]),
  ];

  for (const x of actions.remove_dislikes ?? []) {
    const xl = x.toLowerCase();
    dislikes = dislikes.filter((d) => d.toLowerCase() !== xl);
  }
  dislikes = [...new Set([...dislikes, ...(actions.add_dislikes ?? [])])];

  const touchesPrefs =
    actions.alert_sensitivity != null ||
    (actions.add_interests?.length ?? 0) > 0 ||
    (actions.remove_interests?.length ?? 0) > 0 ||
    (actions.add_dislikes?.length ?? 0) > 0 ||
    (actions.remove_dislikes?.length ?? 0) > 0;

  if (touchesPrefs) {
    const prefPatch: Parameters<typeof updatePreferences>[1] = {
      interests,
      dislikes,
    };
    if (actions.alert_sensitivity != null) {
      prefPatch.alert_sensitivity = actions.alert_sensitivity;
    }
    await updatePreferences(userId, prefPatch);
  }

  const hasOverlay =
    (actions.briefing_boost_sections?.length ?? 0) > 0 ||
    (actions.briefing_mute_sections?.length ?? 0) > 0 ||
    (actions.breaking_keywords_add?.length ?? 0) > 0 ||
    (actions.breaking_keywords_remove?.length ?? 0) > 0;

  if (hasOverlay) {
    await patchBriefingOverlay(userId, (prev) => {
      const boost = new Set(prev.boost_categories ?? []);
      const ign = new Set(prev.ignore_categories ?? []);
      const kws = new Set(prev.tier1_keywords ?? []);

      for (const s of actions.briefing_boost_sections ?? []) {
        const c = matchBriefingSection(s);
        if (c) {
          boost.add(c);
          ign.delete(c);
        }
      }
      for (const s of actions.briefing_mute_sections ?? []) {
        const c = matchBriefingSection(s);
        if (c) {
          ign.add(c);
          boost.delete(c);
        }
      }
      for (const w of actions.breaking_keywords_add ?? []) {
        kws.add(w.trim().toLowerCase());
      }
      for (const w of actions.breaking_keywords_remove ?? []) {
        const wl = w.trim().toLowerCase();
        for (const k of [...kws]) {
          if (k.toLowerCase() === wl) {
            kws.delete(k);
          }
        }
      }

      return {
        ...prev,
        boost_categories: [...boost],
        ignore_categories: [...ign],
        tier1_keywords: [...kws],
      };
    });
  }

  logger.info("Applied assistant preference actions", {
    userId,
    keys: Object.keys(actions).filter(
      (k) => actions[k as keyof typeof actions] != null
    ),
  });
}

function buildSystemPrompt(prefsBlock: string, articlesBlock: string): string {
  const sections = BRIEFING_SECTIONS.join(" | ");
  return `You are the user's personal intelligence briefing assistant (Telegram).

You receive:
1) Their saved preferences.
2) A numbered list of recent stories from their monitoring pipeline. Items marked in_email_digest appeared in (or were candidates for) their email/Telegram morning digest. Items marked recent_alert were surfaced as a high-priority alert. Refer to stories by number (e.g. "story 2") when helpful.

Your job:
- Answer questions about these stories, compare them, explain why something matters, or discuss implications — stay grounded in evidence and avoid fabricating facts.
- If the user asks about something beyond the provided stories, use current web information when available and synthesize it with the briefing context.
- Give high-signal analysis: likely scenarios, key indicators to watch, risks, and what would change your view.
- When using web information, briefly cite sources in plain text (outlet + date/time if available). If evidence is weak or mixed, say so clearly.
- Help them tune what they see: interests, filters, briefing section emphasis, alert sensitivity, breaking keywords — only when they clearly want a change.
- Be concise; Telegram messages should be readable on a phone.
- Use a direct, natural human tone. Avoid robotic stock phrases like "I can only..." or "I don't have specific insights."
- If certainty is limited, still give the best reasoned take with confidence levels (high/medium/low), then state what new evidence would change the view.
- For prediction questions, provide:
  1) most likely scenario,
  2) plausible alternative,
  3) concrete signals to monitor over the next days/weeks.
- Never answer with a refusal-only message. Even when uncertain, provide a best-effort assessment grounded in available evidence.
- Do not mention limitations in a robotic way ("I am just an AI", "I can only provide"). Lead with analysis first, then uncertainty.
- Prioritize usefulness over hedging. The user wants an operator-style read, not a generic disclaimer.
- Never tell the user to "run the pipeline" or "wait for the next digest" as your main answer.
- Never say you lack "briefing context" as a final answer. Give your best analysis using web + prior knowledge.

You MUST respond with a single JSON object (no markdown fences) of this shape:
{"reply":"string shown to the user","actions":{}}

"actions" is optional. Include it only when applying preference changes. Allowed keys inside actions (all optional arrays except alert_sensitivity):
- add_interests, remove_interests (short phrases for the RSS pipeline filter)
- add_dislikes, remove_dislikes
- alert_sensitivity: integer 1-10
- briefing_boost_sections, briefing_mute_sections: use these EXACT section names when possible: ${sections}
- breaking_keywords_add, breaking_keywords_remove: single words or short phrases for breaking-news matching

If nothing to update, use "actions": {} or omit actions.

User preferences:
${prefsBlock}

Recent stories (numbered):
${articlesBlock}`;
}

function polishReplyTone(reply: string): string {
  let out = reply.trim();
  if (!out) return out;

  // Strip robotic disclaimer phrases that make responses feel generic.
  const roboticPatterns: RegExp[] = [
    /I can only provide[^.]*\.\s*/gi,
    /I don't have specific information[^.]*\.\s*/gi,
    /I don't have specific insights[^.]*\.\s*/gi,
    /I don't have[^.]*briefing context[^.]*\.\s*/gi,
    /in the context of your briefing[^.]*\.\s*/gi,
    /If you're looking for recent news[^.]*\.\s*/gi,
    /I suggest (running the pipeline|waiting for the next digest)[^.]*\.\s*/gi,
    /As an AI[^.]*\.\s*/gi,
    /I (can't|cannot) (predict|know|guarantee)[^.]*\.\s*/gi,
    /I do not have access to[^.]*\.\s*/gi,
    /I cannot browse[^.]*\.\s*/gi,
  ];
  for (const pattern of roboticPatterns) {
    out = out.replace(pattern, "");
  }

  return out.trim();
}

function looksPredictiveQuestion(userMessage: string): boolean {
  return /\b(will|likely|probability|chance|odds|next|forecast|expect|do you think)\b/i.test(
    userMessage
  );
}

function enforceInsightFormat(userMessage: string, reply: string): string {
  const cleaned = polishReplyTone(reply);
  if (!cleaned) return cleaned;

  if (!looksPredictiveQuestion(userMessage)) {
    return cleaned;
  }

  const hasScenario =
    /\b(most likely|alternative|base case|bull case|bear case|scenario)\b/i.test(
      cleaned
    );
  const hasWatchlist = /\b(what to watch|watchlist|signals|indicator)\b/i.test(
    cleaned
  );
  const hasConfidence = /\bconfidence\b/i.test(cleaned);

  if (hasScenario && hasWatchlist && hasConfidence) {
    return cleaned;
  }

  return [
    `Quick take: ${cleaned}`,
    "",
    "Most likely scenario:",
    "- Short-term continuation of the current trajectory unless a clear policy or military trigger appears.",
    "",
    "Plausible alternative:",
    "- A rapid shift if new intelligence, domestic politics, or allied pressure changes decision incentives.",
    "",
    "What to watch next:",
    "- Official statements from principals and spokespersons",
    "- Military posture changes, sanctions activity, or emergency diplomacy",
    "- High-credibility reporting that confirms operational intent (not commentary)",
    "",
    "Confidence: medium (directional view, event timing remains uncertain).",
  ].join("\n");
}

function isLowValueRefusal(reply: string): boolean {
  return /briefing context|run the pipeline|wait for the next digest|don't have specific information|cannot provide/i.test(
    reply
  );
}

function buildRecoveryInsight(userMessage: string, reply: string): string {
  const subject = userMessage.trim().replace(/\s+/g, " ").slice(0, 180);
  return [
    `Quick take: Here's the strongest read on "${subject}" right now, based on available signals.`,
    "",
    `Most likely scenario: ${
      polishReplyTone(reply) ||
      "Short-term continuity with periodic volatility while decision-makers react to new facts and incentives."
    }`,
    "",
    "Plausible alternative:",
    "- A sharper turn if new intelligence, domestic political pressure, or allied signaling changes the decision calculus.",
    "",
    "What to watch next:",
    "- Official statements and policy actions (not just commentary)",
    "- Resource/military posture changes and diplomatic sequencing",
    "- Cross-confirmed reporting from multiple high-credibility outlets",
    "",
    "Confidence: medium (directional confidence, timing confidence lower).",
  ].join("\n");
}

async function requestAssistantJson(
  openai: OpenAI,
  system: string,
  userMessage: string
): Promise<string> {
  const webModel = process.env.CHAT_WEB_MODEL ?? process.env.CHAT_MODEL ?? "gpt-4.1-mini";
  const fallbackModel = process.env.CHAT_MODEL ?? "gpt-4o-mini";
  const webSearchDisabled = process.env.DISABLE_CHAT_WEB_SEARCH === "true";

  if (!webSearchDisabled) {
    const webModels = [...new Set([webModel, "gpt-4.1-mini", "gpt-4.1"])];
    for (const model of webModels) {
      try {
        const response = await openai.responses.create({
          model,
          instructions: system,
          input: userMessage,
          temperature: 0.35,
          max_output_tokens: 1000,
          tools: [{ type: "web_search_preview", search_context_size: "high" }],
          text: {
            format: {
              type: "json_schema",
              name: "assistant_response",
              schema: AssistantResponseJsonSchema,
              strict: true,
            },
          },
        });
        const raw = response.output_text?.trim() ?? "";
        if (raw) return raw;
        throw new Error("Empty output_text from responses API");
      } catch (err) {
        logger.warn("Web-enabled assistant call failed; trying next option", {
          error: err instanceof Error ? err.message : String(err),
          model,
        });
      }
    }
  }

  const response = await openai.chat.completions.create({
    model: fallbackModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ],
    temperature: 0.35,
    max_tokens: 1000,
    response_format: { type: "json_object" },
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}

export async function runBriefingAssistant(
  userId: string,
  userMessage: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return "I can answer as soon as the AI key is connected. Add OPENAI_API_KEY, then ask again and I'll give you a full analysis.";
  }

  const allowed = await canMakeAICall();
  if (!allowed) {
    return "We've hit today's AI budget cap, so I can't run a fresh analysis right now. If you raise MAX_DAILY_AI_CALLS, I'll resume immediately. /status shows usage.";
  }

  const [prefs, recent, lastAlert] = await Promise.all([
    getPreferences(userId),
    getRecentArticles(56),
    getLastAlertedArticle(),
  ]);

  const lastUrl = lastAlert?.url ?? null;
  const sorted = sortForBriefingContext(recent.slice(0, 80), lastUrl).slice(0, 18);
  const articlesBlock = formatArticleBlock(sorted, lastUrl);

  const o = prefs.briefing_overlay ?? {};
  const prefsBlock = [
    `alert_sensitivity: ${prefs.alert_sensitivity}/10`,
    `interests: ${prefs.interests.join(", ") || "(none)"}`,
    `dislikes: ${prefs.dislikes.join(", ") || "(none)"}`,
    `briefing_boost: ${(o.boost_categories ?? []).join(", ") || "(none)"}`,
    `briefing_muted: ${(o.ignore_categories ?? []).join(", ") || "(none)"}`,
    `breaking_keywords: ${(o.tier1_keywords ?? []).join(", ") || "(defaults)"}`,
  ].join("\n");

  const system = buildSystemPrompt(prefsBlock, articlesBlock);

  const openai = new OpenAI({ apiKey });
  let raw: string;
  try {
    raw = await requestAssistantJson(openai, system, userMessage);
  } catch (err) {
    logger.error("OpenAI chat failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "I hit a temporary issue while generating your analysis. Please send that again and I'll take another pass.";
  }

  let parsed: z.infer<typeof AssistantResponseSchema>;
  try {
    parsed = AssistantResponseSchema.parse(JSON.parse(raw));
  } catch (err) {
    logger.warn("Assistant JSON parse failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await recordAICall();
    return "I had a formatting hiccup, but I can still answer this. Re-send your question and I'll give a tighter, clearer take.";
  }

  await recordAICall();

  try {
    await applyActions(userId, parsed.actions ?? {});
  } catch (err) {
    logger.error("applyActions failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let out = enforceInsightFormat(userMessage, parsed.reply);
  if (isLowValueRefusal(out)) {
    out = buildRecoveryInsight(userMessage, out);
  }
  if (out.length > TG_MAX) {
    out = out.slice(0, TG_MAX - 12) + "\n…(truncated)";
  }
  return out;
}

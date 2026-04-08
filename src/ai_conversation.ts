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
- Answer questions about these stories, compare them, explain why something matters, or discuss implications — stay grounded in the provided text; do not invent events or URLs.
- If they ask about something not in the list, say you don't have it in the current briefing context and suggest running the pipeline or waiting for the next digest.
- Help them tune what they see: interests, filters, briefing section emphasis, alert sensitivity, breaking keywords — only when they clearly want a change.
- Be concise; Telegram messages should be readable on a phone.

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

export async function runBriefingAssistant(
  userId: string,
  userMessage: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return "OpenAI is not configured (OPENAI_API_KEY). Add it to your environment to chat with the assistant.";
  }

  const allowed = await canMakeAICall();
  if (!allowed) {
    return "Today's AI budget is used up (shared with the news pipeline). Try again tomorrow or raise MAX_DAILY_AI_CALLS. /status shows usage.";
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
  const model = process.env.CHAT_MODEL ?? "gpt-4o-mini";

  const openai = new OpenAI({ apiKey });
  let raw: string;
  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      temperature: 0.35,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });
    raw = response.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    logger.error("OpenAI chat failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "The AI request failed. Check OPENAI_API_KEY and try again.";
  }

  let parsed: z.infer<typeof AssistantResponseSchema>;
  try {
    parsed = AssistantResponseSchema.parse(JSON.parse(raw));
  } catch (err) {
    logger.warn("Assistant JSON parse failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await recordAICall();
    return "I couldn't format that reply. Try asking in a shorter message.";
  }

  await recordAICall();

  try {
    await applyActions(userId, parsed.actions ?? {});
  } catch (err) {
    logger.error("applyActions failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let out = parsed.reply.trim();
  if (out.length > TG_MAX) {
    out = out.slice(0, TG_MAX - 12) + "\n…(truncated)";
  }
  return out;
}

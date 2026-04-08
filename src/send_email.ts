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
import { getTopArticles } from "./scoring";
import { formatDigestPlainText, sendDigestTelegram } from "./telegram_digest";
import {
  getDailyUsageReport,
  recordAICall,
} from "./usage_limiter";
import { BRIEFING_SECTIONS } from "./types";
import type { ArticleHistory, SourceRegistry, UsageReport } from "./types";

const logger = createLogger("send_email");

// ── Briefing data structure returned by AI ──

interface KeySignal {
  title: string;
  url: string;
  source: string;
  category: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  trend: "rising" | "falling" | "stable" | "new";
  source_count: number;
  tags: string[];
  summary: string;
}

interface BriefingData {
  one_sentence: string;
  key_signals: KeySignal[];
  market_intelligence: {
    analysis: string;
    implications: string[];
    risk_scenarios: string[];
  };
  contrarian_watch: Array<{ narrative: string; risk_if_wrong: string }>;
  blindspots: string[];
  power_nodes: Array<{
    entity: string;
    importance: "HIGH" | "MEDIUM" | "LOW";
    mentions: number;
    context: string;
  }>;
  opportunities: string[];
  section_articles: Record<
    string,
    Array<{
      title: string;
      url: string;
      source: string;
      verification: "VERIFIED" | "DEVELOPING" | "UNVERIFIED";
      status: string;
      time_label: string;
      bullets: string[];
      related_sources: string[];
    }>
  >;
}

// ── Transporter ──

function createTransport() {
  const t = createSmtpTransport();
  if (!t) {
    logger.warn("Email SMTP not configured — digest email channel skipped");
  }
  return t;
}

function digestEmailConfigured(): boolean {
  if (!createSmtpTransport()) return false;
  const from = (
    process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER || process.env.SMTP_USER || ""
  ).trim();
  const to = (process.env.EMAIL_TO || "").trim();
  return Boolean(from && to);
}

function digestTelegramConfigured(): boolean {
  const skipTg =
    process.env.SEND_DIGEST_TELEGRAM === "false" ||
    process.env.SEND_DIGEST_TELEGRAM === "0";
  if (skipTg) return false;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return Boolean(token && chatId);
}

// ── AI Briefing Generation ──

const DIGEST_MODEL = process.env.DIGEST_MODEL || "gpt-4o";

async function generateBriefing(
  articles: ArticleHistory[],
  sources: SourceRegistry[],
  interests: string[]
): Promise<BriefingData | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn("No OPENAI_API_KEY — skipping AI briefing");
    return null;
  }

  if (articles.length === 0) return null;

  const openai = new OpenAI({ apiKey });

  const articleData = articles
    .filter((a) => a.title)
    .slice(0, 40)
    .map((a, i) => ({
      idx: i + 1,
      title: a.title,
      source: a.source,
      url: a.url,
      summary: a.summary || "",
      importance: a.importance_score ?? 0,
      credibility: a.credibility_score ?? 0,
      fetched: a.fetched_at,
    }));

  const sourceNames = Array.from(new Set(articles.map((a) => a.source)));
  const sections = BRIEFING_SECTIONS.join(", ");
  const interestsStr = interests.length > 0 ? interests.join(", ") : "geopolitics, markets, crypto, AI, power dynamics";

  const systemPrompt = `You are an elite intelligence analyst producing a comprehensive daily briefing for a reader interested in: ${interestsStr}.

Given today's ${articleData.length} articles from ${sourceNames.length} sources, produce a structured intelligence briefing as JSON.

Available sections for categorization: ${sections}

Rules:
- "one_sentence" must capture THE single most important development today in one punchy sentence
- "key_signals" should be the 8-12 most important stories, ranked. For each: assign a category from the sections list, estimate how many distinct sources covered this story (source_count), assign importance (HIGH/MEDIUM/LOW), trend direction, and 2-3 keyword tags
- "market_intelligence" should have a strategic 2-3 sentence analysis, 2-3 specific implications, and 2-3 risk scenarios
- "contrarian_watch" should identify 2-3 dominant narratives and what happens if they're wrong
- "blindspots" should list 2-4 important topics with NO or minimal coverage today
- "power_nodes" should track 8-10 key entities (countries, companies, people) mentioned, with importance level and mention count
- "opportunities" should suggest 2-3 actionable insights
- "section_articles" should group the top stories into their sections. For each article: determine verification level (VERIFIED = 2+ credible sources agree, DEVELOPING = limited confirmation, UNVERIFIED = single/alt source), provide a status label (e.g. "NEW", "ESCALATING", "DE-ESCALATING", "ONGOING"), a relative time label, 2-3 bullet points of key facts, and list related source names

Return ONLY valid JSON matching this structure. Be specific and analytical, not generic.`;

  try {
    const response = await openai.chat.completions.create({
      model: DIGEST_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(articleData) },
      ],
      temperature: 0.4,
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as BriefingData;
    await recordAICall();
    logger.info(`AI briefing generated via ${DIGEST_MODEL}`);
    return parsed;
  } catch (err) {
    logger.error("AI briefing generation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── HTML Builder ──

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function importanceBadge(level: string): string {
  const colors: Record<string, { bg: string; fg: string }> = {
    HIGH: { bg: "#fef2f2", fg: "#dc2626" },
    MEDIUM: { bg: "#fffbeb", fg: "#d97706" },
    LOW: { bg: "#f0fdf4", fg: "#16a34a" },
  };
  const c = colors[level] || colors.LOW;
  return `<span style="display:inline-block;background:${c.bg};color:${c.fg};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:0.5px">${esc(level)}</span>`;
}

function trendIcon(trend: string): string {
  const icons: Record<string, string> = {
    rising: "🔺",
    falling: "🔻",
    stable: "➡️",
    new: "🆕",
  };
  return icons[trend] || "➡️";
}

function verificationBadge(v: string): string {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    VERIFIED: { label: "VERIFIED", bg: "#dcfce7", fg: "#166534" },
    DEVELOPING: { label: "DEVELOPING", bg: "#fef9c3", fg: "#854d0e" },
    UNVERIFIED: { label: "UNVERIFIED", bg: "#fee2e2", fg: "#991b1b" },
  };
  const s = map[v] || map.UNVERIFIED;
  return `<span style="display:inline-block;background:${s.bg};color:${s.fg};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.5px">${s.label}</span>`;
}

function sectionIcon(section: string): string {
  const icons: Record<string, string> = {
    "World & Geopolitics": "🌍",
    "Wars & Conflicts": "⚔️",
    "Economy & Markets": "📊",
    Stocks: "📈",
    Crypto: "🪙",
    "AI & Technology": "🤖",
    "Power & Elite Activity": "👁️",
    "Conspiracy / Unverified Signals": "🔮",
  };
  return icons[section] || "📰";
}

function buildBriefingHtml(
  briefing: BriefingData,
  allArticles: ArticleHistory[],
  sources: SourceRegistry[],
  usage: UsageReport
): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }) + " UTC";

  const sourceCount = new Set(allArticles.map((a) => a.source)).size;
  const storyCount = allArticles.length;
  const sectionCount = Object.keys(briefing.section_articles || {}).length;

  // ── Key Signals ──
  const signalRows = (briefing.key_signals || [])
    .map((s) => {
      const tags = (s.tags || [])
        .map(
          (t) =>
            `<span style="display:inline-block;background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:8px;font-size:10px;margin-right:3px">${esc(t)}</span>`
        )
        .join("");
      return `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <span style="font-size:16px;line-height:1">${trendIcon(s.trend)}</span>
            <div style="flex:1">
              <a href="${esc(s.url)}" style="color:#0f172a;font-weight:600;text-decoration:none;font-size:14px;line-height:1.4">${esc(s.title)}</a>
              <div style="margin-top:4px;font-size:12px;color:#64748b">
                ${esc(s.category)} · ${s.source_count} source${s.source_count !== 1 ? "s" : ""} · ${tags}
              </div>
            </div>
            <div style="text-align:right;white-space:nowrap">
              ${importanceBadge(s.importance)}
            </div>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  // ── Market Intelligence ──
  const implications = (briefing.market_intelligence?.implications || [])
    .map((i) => `<li style="margin-bottom:6px;color:#334155;font-size:13px">${esc(i)}</li>`)
    .join("");
  const risks = (briefing.market_intelligence?.risk_scenarios || [])
    .map((r) => `<li style="margin-bottom:6px;color:#dc2626;font-size:13px">${esc(r)}</li>`)
    .join("");

  // ── Contrarian Watch ──
  const contrarian = (briefing.contrarian_watch || [])
    .map(
      (c) => `
      <div style="padding:10px 14px;background:#fffbeb;border-radius:6px;margin-bottom:8px">
        <div style="font-size:13px;color:#92400e">🔄 ${esc(c.narrative)}</div>
        <div style="font-size:12px;color:#b45309;margin-top:4px;font-style:italic">Risk: If wrong → ${esc(c.risk_if_wrong)}</div>
      </div>`
    )
    .join("");

  // ── Blindspots ──
  const blindspots = (briefing.blindspots || [])
    .map(
      (b) =>
        `<div style="padding:8px 14px;background:#f8fafc;border-left:3px solid #cbd5e1;margin-bottom:6px;font-size:13px;color:#475569">${esc(b)}</div>`
    )
    .join("");

  // ── Power Nodes ──
  const powerNodes = (briefing.power_nodes || [])
    .map(
      (p) => `
      <tr>
        <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px;color:#0f172a">${esc(p.entity)}</td>
        <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:center">${importanceBadge(p.importance)}</td>
        <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:12px;color:#64748b">${p.mentions}</td>
        <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${esc(p.context)}</td>
      </tr>`
    )
    .join("");

  // ── Opportunities ──
  const opportunities = (briefing.opportunities || [])
    .map(
      (o) =>
        `<li style="margin-bottom:8px;color:#166534;font-size:13px">${esc(o)}</li>`
    )
    .join("");

  // ── Full Section Briefing ──
  const sectionBlocks = Object.entries(briefing.section_articles || {})
    .map(([sectionName, articles]) => {
      if (!articles || articles.length === 0) return "";

      const articleCards = articles
        .map((a) => {
          const bullets = (a.bullets || [])
            .map(
              (b) =>
                `<li style="margin-bottom:4px;color:#334155;font-size:13px;line-height:1.5">${esc(b)}</li>`
            )
            .join("");
          const relatedSources = (a.related_sources || [])
            .map((s) => esc(s))
            .join("  ·  ");

          return `
          <div style="padding:14px 16px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
              <a href="${esc(a.url)}" style="color:#0f172a;font-weight:700;text-decoration:none;font-size:14px;line-height:1.3;flex:1">${esc(a.title)}</a>
            </div>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
              ${verificationBadge(a.verification)}
              ${a.status ? `<span style="font-size:11px;color:#64748b;font-weight:600">${esc(a.status)}</span>` : ""}
              ${a.time_label ? `<span style="font-size:11px;color:#94a3b8">🕐 ${esc(a.time_label)}</span>` : ""}
            </div>
            <ul style="margin:0 0 8px 16px;padding:0">${bullets}</ul>
            ${relatedSources ? `<div style="font-size:11px;color:#94a3b8">Read more: ${relatedSources}</div>` : ""}
          </div>`;
        })
        .join("");

      return `
      <div style="margin-bottom:24px">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e2e8f0">
          ${sectionIcon(sectionName)} ${esc(sectionName.toUpperCase())}
        </div>
        ${articleCards}
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:680px;margin:0 auto;background:#ffffff;overflow:hidden;margin-top:0">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#ffffff;padding:32px 24px">
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px">Daily Intelligence Briefing</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:6px">${dateStr} · ${timeStr}</div>
    <div style="font-size:12px;color:#64748b;margin-top:4px">${sourceCount} sources · ${storyCount} stories · ${sectionCount} sections</div>
    <div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap;font-size:11px">
      <span style="background:rgba(34,197,94,0.15);color:#86efac;padding:3px 10px;border-radius:10px">VERIFIED — 2+ credible sources agree</span>
      <span style="background:rgba(234,179,8,0.15);color:#fde047;padding:3px 10px;border-radius:10px">DEVELOPING — Limited confirmation</span>
      <span style="background:rgba(239,68,68,0.15);color:#fca5a5;padding:3px 10px;border-radius:10px">UNVERIFIED — Single / alt source</span>
    </div>
  </div>

  <div style="padding:24px">

    <!-- One Sentence -->
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px">
      <div style="font-size:12px;font-weight:700;color:#3b82f6;margin-bottom:6px;letter-spacing:1px">⚡ TODAY IN ONE SENTENCE</div>
      <div style="font-size:15px;color:#1e293b;line-height:1.5;font-weight:500">${esc(briefing.one_sentence)}</div>
    </div>

    <!-- Key Signals -->
    <div style="margin-bottom:28px">
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:12px;letter-spacing:0.5px">🧠 KEY SIGNALS</div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${signalRows || '<tr><td style="padding:16px;text-align:center;color:#94a3b8">No signals detected</td></tr>'}</tbody>
      </table>
    </div>

    <!-- Market Intelligence -->
    <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:28px">
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:12px;letter-spacing:0.5px">📊 MARKET INTELLIGENCE</div>
      <div style="font-size:14px;color:#334155;line-height:1.6;margin-bottom:14px">${esc(briefing.market_intelligence?.analysis || "")}</div>
      ${implications ? `<div style="font-weight:700;font-size:12px;color:#0f172a;margin-bottom:6px">Implications:</div><ul style="margin:0 0 14px 16px;padding:0">${implications}</ul>` : ""}
      ${risks ? `<div style="font-weight:700;font-size:12px;color:#dc2626;margin-bottom:6px">⚠️ Risk Scenarios:</div><ul style="margin:0 0 0 16px;padding:0">${risks}</ul>` : ""}
    </div>

    <!-- Contrarian Watch -->
    ${contrarian ? `
    <div style="margin-bottom:28px">
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:12px;letter-spacing:0.5px">⚠️ CONTRARIAN WATCH</div>
      ${contrarian}
    </div>` : ""}

    <!-- Blindspots -->
    ${blindspots ? `
    <div style="margin-bottom:28px">
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:12px;letter-spacing:0.5px">🚨 BLINDSPOTS — MISSING COVERAGE</div>
      ${blindspots}
    </div>` : ""}

    <!-- Power Nodes -->
    ${powerNodes ? `
    <div style="margin-bottom:28px">
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:12px;letter-spacing:0.5px">🔄 POWER NODE TRACKER</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 14px;font-size:11px;color:#64748b;border-bottom:2px solid #e2e8f0">ENTITY</th>
            <th style="text-align:center;padding:8px 14px;font-size:11px;color:#64748b;border-bottom:2px solid #e2e8f0">LEVEL</th>
            <th style="text-align:center;padding:8px 14px;font-size:11px;color:#64748b;border-bottom:2px solid #e2e8f0">MENTIONS</th>
            <th style="text-align:left;padding:8px 14px;font-size:11px;color:#64748b;border-bottom:2px solid #e2e8f0">CONTEXT</th>
          </tr>
        </thead>
        <tbody>${powerNodes}</tbody>
      </table>
    </div>` : ""}

    <!-- Opportunities -->
    ${opportunities ? `
    <div style="background:#f0fdf4;border-radius:12px;padding:20px;margin-bottom:28px">
      <div style="font-size:14px;font-weight:800;color:#166534;margin-bottom:12px;letter-spacing:0.5px">💡 OPPORTUNITIES</div>
      <ul style="margin:0 0 0 16px;padding:0">${opportunities}</ul>
    </div>` : ""}

    <!-- Divider -->
    <div style="border-top:3px solid #e2e8f0;margin:8px 0 24px 0;position:relative">
      <span style="position:relative;top:-10px;background:#ffffff;padding:0 12px;font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:1px">FULL BRIEFING BELOW</span>
    </div>

    <!-- Full Section Briefing -->
    ${sectionBlocks}

  </div>

  <!-- Footer -->
  <div style="background:#0f172a;padding:20px 24px;text-align:center">
    <div style="font-size:12px;color:#64748b">Jeff Intelligence System · Daily Briefing</div>
    <div style="font-size:11px;color:#475569;margin-top:4px">AI: ${esc(DIGEST_MODEL)} · Budget: ${usage.callsUsed}/${usage.maxCalls} calls</div>
  </div>

</div>
</body>
</html>`;
}

// ── Fallback HTML (no AI) ──

function buildFallbackHtml(
  topArticles: ArticleHistory[],
  usage: UsageReport
): string {
  const rows = topArticles
    .map(
      (a, i) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:2px">#${i + 1} · ${esc(a.source)}</div>
        <a href="${esc(a.url)}" style="color:#1e293b;font-weight:600;text-decoration:none;font-size:15px">${esc(a.title)}</a>
        ${a.summary ? `<div style="color:#475569;font-size:13px;margin-top:4px">${esc(a.summary)}</div>` : ""}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;text-align:center;vertical-align:top;white-space:nowrap">
        ${a.importance_score ? `<span style="color:#2563eb;font-weight:bold">${a.importance_score}/10</span>` : '<span style="color:#94a3b8">—</span>'}
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;margin-top:20px">
  <div style="background:#0f172a;color:#fff;padding:24px 20px">
    <div style="font-size:20px;font-weight:700">📡 Intelligence Digest</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:4px">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px">AI briefing unavailable — showing top stories only</div>
  </div>
  <div style="padding:20px">
    <table style="width:100%;border-collapse:collapse">
      <tbody>${rows || '<tr><td style="padding:20px;text-align:center;color:#94a3b8">No articles today</td></tr>'}</tbody>
    </table>
  </div>
  <div style="background:#f8fafc;padding:16px 20px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0">
    Jeff Intelligence System · AI: ${usage.callsUsed}/${usage.maxCalls} calls
  </div>
</div></body></html>`;
}

// ── Plain text fallback ──

function buildPlainText(
  briefing: BriefingData | null,
  topArticles: ArticleHistory[],
  usage: UsageReport
): string {
  const lines = [
    "=== DAILY INTELLIGENCE BRIEFING ===",
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `AI Budget: ${usage.callsUsed}/${usage.maxCalls} calls used`,
    "",
  ];

  if (briefing) {
    lines.push(`TODAY: ${briefing.one_sentence}`, "");

    lines.push("KEY SIGNALS:");
    for (const s of briefing.key_signals || []) {
      lines.push(`  ${trendIcon(s.trend)} ${s.title} [${s.importance}]`);
      lines.push(`     ${s.category} · ${s.source_count} sources`);
      lines.push(`     ${s.url}`, "");
    }

    if (briefing.market_intelligence?.analysis) {
      lines.push("MARKET INTELLIGENCE:", `  ${briefing.market_intelligence.analysis}`, "");
    }

    if (briefing.opportunities?.length) {
      lines.push("OPPORTUNITIES:");
      for (const o of briefing.opportunities) lines.push(`  - ${o}`);
      lines.push("");
    }
  } else {
    lines.push("TOP STORIES:");
    topArticles.forEach((a, i) => {
      lines.push(`  ${i + 1}. ${a.title}`);
      if (a.summary) lines.push(`     ${a.summary}`);
      lines.push(`     Score: ${a.importance_score ?? "n/a"}/10 | ${a.url}`, "");
    });
  }

  return lines.join("\n");
}

// ── Main export ──

export async function sendDailyDigest(
  interests: string[] = []
): Promise<boolean> {
  try {
    logger.info("Building daily intelligence briefing");

    if (!digestEmailConfigured() && !digestTelegramConfigured()) {
      logger.error(
        "No digest delivery configured: set SMTP secrets (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_TO) and/or Telegram secrets."
      );
      await logSystemEvent({
        level: "error",
        source: "digest",
        message: "Daily digest skipped: no delivery channel configured",
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

    const topArticles = getTopArticles(recentArticles, 20);

    logger.info(`Collected ${recentArticles.length} articles, ${sources.length} sources`);

    // Generate AI briefing (single call)
    const briefing = await generateBriefing(recentArticles, sources, effectiveInterests);

    const html = briefing
      ? buildBriefingHtml(briefing, recentArticles, sources, usage)
      : buildFallbackHtml(topArticles, usage);
    const text = buildPlainText(briefing, topArticles, usage);

    // ── Send email ──
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
          subject: `📡 Daily Intelligence Briefing — ${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`,
          html,
          text,
        });
        await markEmailed(topArticles.map((a) => a.url));
        logger.info("Intelligence briefing email sent", { to, articles: topArticles.length });
        emailOk = true;
      } else {
        logger.warn("EMAIL_FROM or EMAIL_TO missing — skipping email");
      }
    } else {
      logger.warn("No email SMTP — skipping email channel");
    }

    // ── Send Telegram (if enabled) ──
    const skipTg =
      process.env.SEND_DIGEST_TELEGRAM === "false" ||
      process.env.SEND_DIGEST_TELEGRAM === "0";
    let telegramOk = false;
    if (!skipTg) {
      try {
        const topForTg = getTopArticles(recentArticles, 6);
        const insight = briefing?.one_sentence || null;
        const plain = formatDigestPlainText(topForTg, usage, insight);
        telegramOk = await sendDigestTelegram(plain);
      } catch (err) {
        logger.warn("Telegram digest failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!emailOk && !telegramOk) {
      logger.error("No delivery channel succeeded");
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

    await saveDigestArchive({
      channels,
      subject: `Intelligence Briefing — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      html_body: html,
      plain_text: text.slice(0, 120_000),
      article_urls: topArticles.map((a) => a.url),
      meta: {
        email_ok: emailOk,
        telegram_ok: telegramOk,
        model: DIGEST_MODEL,
        briefing_generated: Boolean(briefing),
      },
    });

    await logSystemEvent({
      level: "info",
      source: "digest",
      message: `Briefing delivered via ${channels.join(" + ")} (${DIGEST_MODEL})`,
      meta: { article_count: recentArticles.length },
    });

    logger.info(`Morning briefing complete via ${channels.join(" + ")}`);
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
        logger.error("Morning briefing failed — check SMTP secrets and OPENAI_API_KEY");
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

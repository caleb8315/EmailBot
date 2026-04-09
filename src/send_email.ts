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
  why_it_matters: string;
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

Given today's ${articleData.length} articles from ${sourceNames.length} sources, produce a structured intelligence briefing as JSON. The reader wants to UNDERSTAND what is happening and WHY it matters — not just see headlines.

Available sections for categorization: ${sections}

Rules:
- "one_sentence": THE single most important development today in one punchy sentence that captures both the event and its significance
- "key_signals": the 8-12 most important stories, ranked. For EACH story include:
  - title, url, source, category (from sections list), importance (HIGH/MEDIUM/LOW), trend (rising/falling/stable/new), source_count, tags (2-3 keywords)
  - "summary": 2-3 sentence explanation of what happened. Be specific with names, numbers, and facts — not vague.
  - "why_it_matters": 1-2 sentences explaining the strategic significance. Connect it to bigger trends, explain second-order effects, or why the reader should care. This is the most important field — make it sharp and insightful.
- "market_intelligence":
  - "analysis": 4-5 sentence strategic assessment connecting the dots across today's top stories. Identify themes, correlations between events, and what the overall picture suggests. Be specific — reference actual events and data points.
  - "implications": 3-4 specific, actionable implications (not generic platitudes like "markets may be volatile"). Each should reference a concrete scenario.
  - "risk_scenarios": 3-4 specific downside scenarios with clear trigger conditions (e.g. "If X happens, then Y because Z")
- "contrarian_watch": array of 2-3 objects with "narrative" (the dominant consensus view) and "risk_if_wrong" (specific consequences if the consensus is wrong). Be provocative and specific.
- "blindspots": 2-4 important topics or regions with NO or minimal coverage today that the reader should be aware of
- "power_nodes": 8-10 key entities (countries, companies, leaders) with importance, mentions count, and a brief "context" explaining their role today
- "opportunities": 2-3 actionable insights — specific enough that someone could act on them (reference sectors, assets, or strategies)
- "section_articles": group the top 15-20 stories into their sections. For each article:
  - verification: VERIFIED (2+ credible sources), DEVELOPING (limited confirmation), UNVERIFIED (single/alt source)
  - status label: NEW, ESCALATING, DE-ESCALATING, ONGOING
  - time_label: relative time
  - "bullets": 3-4 bullet points that tell the full story — include key facts, context, and what to watch next. The reader should understand the story from bullets alone without clicking through.
  - related_sources: list of source names covering this story

Write like a senior analyst briefing a decision-maker. Be specific, analytical, and connect the dots. Avoid filler language.
Return ONLY valid JSON.`;

  try {
    const response = await openai.chat.completions.create({
      model: DIGEST_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(articleData) },
      ],
      temperature: 0.4,
      max_tokens: 8000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const raw = JSON.parse(content);
    const toArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
    const parsed: BriefingData = {
      one_sentence: typeof raw.one_sentence === "string" ? raw.one_sentence : "",
      key_signals: toArray(raw.key_signals),
      market_intelligence: {
        analysis: typeof raw.market_intelligence?.analysis === "string" ? raw.market_intelligence.analysis : "",
        implications: toArray(raw.market_intelligence?.implications),
        risk_scenarios: toArray(raw.market_intelligence?.risk_scenarios),
      },
      contrarian_watch: toArray(raw.contrarian_watch),
      blindspots: toArray(raw.blindspots),
      power_nodes: toArray(raw.power_nodes),
      opportunities: toArray(raw.opportunities),
      section_articles: typeof raw.section_articles === "object" && raw.section_articles !== null ? raw.section_articles : {},
    };
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

function esc(text: unknown): string {
  if (text === null || text === undefined) return "";
  const s = typeof text === "string" ? text : JSON.stringify(text);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function importanceBadge(level: string): string {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    HIGH: { bg: "#ff4d6a", fg: "#ffffff", border: "#ff4d6a" },
    MEDIUM: { bg: "#f59e0b", fg: "#ffffff", border: "#f59e0b" },
    LOW: { bg: "#10b981", fg: "#ffffff", border: "#10b981" },
  };
  const c = colors[level] || colors.LOW;
  return `<span style="display:inline-block;background:${c.bg};color:${c.fg};padding:3px 10px;border-radius:12px;font-size:10px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase">${esc(level)}</span>`;
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
  const map: Record<string, { label: string; bg: string; fg: string; icon: string }> = {
    VERIFIED: { label: "VERIFIED", bg: "#10b981", fg: "#ffffff", icon: "✓" },
    DEVELOPING: { label: "DEVELOPING", bg: "#f59e0b", fg: "#ffffff", icon: "◐" },
    UNVERIFIED: { label: "UNVERIFIED", bg: "#ef4444", fg: "#ffffff", icon: "!" },
  };
  const s = map[v] || map.UNVERIFIED;
  return `<span style="display:inline-block;background:${s.bg};color:${s.fg};padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:0.6px">${s.icon} ${s.label}</span>`;
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
            `<span style="display:inline-block;background:#1e2030;color:#818cf8;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;margin-right:4px">${esc(t)}</span>`
        )
        .join("");
      const summaryBlock = s.summary
        ? `<div style="margin-top:8px;font-size:13px;color:#c9d1d9;line-height:1.55">${esc(s.summary)}</div>`
        : "";
      const wimBlock = s.why_it_matters
        ? `<div style="margin-top:6px;font-size:12px;color:#a5b4fc;line-height:1.5;padding-left:12px;border-left:2px solid #4338ca"><strong>Why it matters:</strong> ${esc(s.why_it_matters)}</div>`
        : "";
      return `
      <tr>
        <td style="padding:18px 20px;border-bottom:1px solid #30363d">
          <table style="width:100%;border-collapse:collapse"><tr>
            <td style="width:28px;vertical-align:top;padding-right:10px">
              <span style="font-size:18px;line-height:1">${trendIcon(s.trend)}</span>
            </td>
            <td style="vertical-align:top">
              <a href="${esc(s.url)}" style="color:#e6edf3;font-weight:700;text-decoration:none;font-size:14px;line-height:1.4">${esc(s.title)}</a>
              <div style="margin-top:5px;font-size:11px;color:#8b949e">
                ${esc(s.category)} · ${s.source_count} source${s.source_count !== 1 ? "s" : ""} · ${tags}
              </div>
              ${summaryBlock}
              ${wimBlock}
            </td>
            <td style="width:70px;vertical-align:top;text-align:right;white-space:nowrap;padding-left:8px">
              ${importanceBadge(s.importance)}
            </td>
          </tr></table>
        </td>
      </tr>`;
    })
    .join("");

  // ── Market Intelligence ──
  const implications = (briefing.market_intelligence?.implications || [])
    .map((i) => `<li style="margin-bottom:8px;color:#c9d1d9;font-size:13px;line-height:1.5">${esc(i)}</li>`)
    .join("");
  const risks = (briefing.market_intelligence?.risk_scenarios || [])
    .map((r) => `<li style="margin-bottom:8px;color:#f85149;font-size:13px;line-height:1.5">${esc(r)}</li>`)
    .join("");

  // ── Contrarian Watch ──
  const contrarian = (briefing.contrarian_watch || [])
    .map(
      (c) => `
      <div style="padding:14px 18px;background:#1c1a00;border:1px solid #3d3200;border-radius:10px;margin-bottom:10px">
        <div style="font-size:13px;color:#d29922;font-weight:600">🔄 ${esc(c.narrative)}</div>
        <div style="font-size:12px;color:#e3b341;margin-top:6px;padding-left:24px">↳ If wrong → ${esc(c.risk_if_wrong)}</div>
      </div>`
    )
    .join("");

  // ── Blindspots ──
  const blindspots = (briefing.blindspots || [])
    .map(
      (b) =>
        `<div style="padding:10px 16px;background:#1c0f0f;border-left:3px solid #f85149;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px;color:#f85149">${esc(b)}</div>`
    )
    .join("");

  // ── Power Nodes ──
  const powerNodes = (briefing.power_nodes || [])
    .map(
      (p) => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #30363d;font-weight:700;font-size:13px;color:#e6edf3">${esc(p.entity)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #30363d;text-align:center">${importanceBadge(p.importance)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #30363d;text-align:center;font-size:13px;font-weight:700;color:#818cf8">${p.mentions}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #30363d;font-size:12px;color:#8b949e">${esc(p.context)}</td>
      </tr>`
    )
    .join("");

  // ── Opportunities ──
  const opportunities = (briefing.opportunities || [])
    .map(
      (o) =>
        `<li style="margin-bottom:10px;color:#3fb950;font-size:13px;line-height:1.5">${esc(o)}</li>`
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
                `<li style="margin-bottom:5px;color:#c9d1d9;font-size:13px;line-height:1.6">${esc(b)}</li>`
            )
            .join("");
          const relatedSources = (a.related_sources || [])
            .map((s) => `<span style="color:#818cf8">${esc(s)}</span>`)
            .join(`<span style="color:#6e7681"> · </span>`);

          return `
          <div style="padding:16px 20px;background:#161b22;border:1px solid #30363d;border-radius:12px;margin-bottom:12px">
            <a href="${esc(a.url)}" style="color:#e6edf3;font-weight:700;text-decoration:none;font-size:14px;line-height:1.4;display:block;margin-bottom:8px">${esc(a.title)}</a>
            <div style="margin-bottom:10px">
              ${verificationBadge(a.verification)}
              ${a.status ? `<span style="display:inline-block;background:#1e2030;color:#818cf8;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;margin-left:6px">${esc(a.status)}</span>` : ""}
              ${a.time_label ? `<span style="font-size:11px;color:#8b949e;margin-left:8px">🕐 ${esc(a.time_label)}</span>` : ""}
            </div>
            <ul style="margin:0 0 10px 16px;padding:0">${bullets}</ul>
            ${relatedSources ? `<div style="font-size:11px;color:#6e7681;padding-top:8px;border-top:1px solid #30363d">Read more: ${relatedSources}</div>` : ""}
          </div>`;
        })
        .join("");

      return `
      <div style="margin-bottom:28px">
        <div style="font-size:15px;font-weight:800;color:#e6edf3;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #4338ca">
          ${sectionIcon(sectionName)}  ${esc(sectionName.toUpperCase())}
        </div>
        ${articleCards}
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6edf3">
<div style="max-width:680px;margin:0 auto;overflow:hidden">

  <!-- Header -->
  <div style="background:#1e1b4b;color:#ffffff;padding:36px 28px 32px 28px">
    <div style="font-size:11px;font-weight:700;color:#a5b4fc;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Jeff Intelligence System</div>
    <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;line-height:1.2">Daily Intelligence Briefing</div>
    <div style="font-size:13px;color:#c7d2fe;margin-top:8px">${dateStr} · ${timeStr}</div>
    <div style="margin-top:10px;display:inline-block;background:#2d2a5e;padding:6px 14px;border-radius:20px;font-size:12px;color:#e0e7ff">
      ${sourceCount} sources · ${storyCount} stories · ${sectionCount} sections
    </div>
    <div style="margin-top:16px;font-size:11px;line-height:2">
      <span style="display:inline-block;background:#0f2b1d;color:#6ee7b7;padding:3px 12px;border-radius:12px;margin-right:6px">✓ VERIFIED</span>
      <span style="display:inline-block;background:#2d1f04;color:#fcd34d;padding:3px 12px;border-radius:12px;margin-right:6px">◐ DEVELOPING</span>
      <span style="display:inline-block;background:#2d0f0f;color:#fca5a5;padding:3px 12px;border-radius:12px">! UNVERIFIED</span>
    </div>
  </div>

  <!-- One Sentence -->
  <div style="background:#161b22;padding:24px 28px 28px 28px">
    <div style="background:#1c2128;border:1px solid #30363d;border-radius:14px;padding:20px 22px">
      <div style="font-size:11px;font-weight:800;color:#a5b4fc;letter-spacing:1.5px;margin-bottom:8px">⚡ TODAY IN ONE SENTENCE</div>
      <div style="font-size:16px;color:#ffffff;line-height:1.6;font-weight:600">${esc(briefing.one_sentence)}</div>
    </div>
  </div>

  <!-- Main Content -->
  <div style="background:#0d1117;padding:28px">

    <!-- Key Signals -->
    <div style="background:#161b22;border-radius:16px;padding:24px;margin-bottom:24px;border:1px solid #30363d">
      <div style="font-size:13px;font-weight:800;color:#e6edf3;margin-bottom:16px;letter-spacing:1px">🧠  KEY SIGNALS</div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${signalRows || '<tr><td style="padding:16px;text-align:center;color:#6e7681">No signals detected</td></tr>'}</tbody>
      </table>
    </div>

    <!-- Market Intelligence -->
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:24px;margin-bottom:24px">
      <div style="font-size:13px;font-weight:800;color:#a5b4fc;margin-bottom:14px;letter-spacing:1px">📊  MARKET INTELLIGENCE</div>
      <div style="font-size:14px;color:#c9d1d9;line-height:1.7;margin-bottom:16px">${esc(briefing.market_intelligence?.analysis || "")}</div>
      ${implications ? `<div style="font-weight:700;font-size:11px;color:#a5b4fc;margin-bottom:8px;letter-spacing:0.5px">IMPLICATIONS</div><ul style="margin:0 0 16px 16px;padding:0">${implications}</ul>` : ""}
      ${risks ? `<div style="font-weight:700;font-size:11px;color:#f85149;margin-bottom:8px;letter-spacing:0.5px">⚠️ RISK SCENARIOS</div><ul style="margin:0 0 0 16px;padding:0">${risks}</ul>` : ""}
    </div>

    <!-- Contrarian Watch -->
    ${contrarian ? `
    <div style="background:#161b22;border-radius:16px;padding:24px;margin-bottom:24px;border:1px solid #30363d">
      <div style="font-size:13px;font-weight:800;color:#e6edf3;margin-bottom:14px;letter-spacing:1px">⚠️  CONTRARIAN WATCH</div>
      ${contrarian}
    </div>` : ""}

    <!-- Blindspots -->
    ${blindspots ? `
    <div style="background:#161b22;border-radius:16px;padding:24px;margin-bottom:24px;border:1px solid #30363d">
      <div style="font-size:13px;font-weight:800;color:#e6edf3;margin-bottom:14px;letter-spacing:1px">🚨  BLINDSPOTS — MISSING COVERAGE</div>
      ${blindspots}
    </div>` : ""}

    <!-- Power Nodes -->
    ${powerNodes ? `
    <div style="background:#161b22;border-radius:16px;padding:24px;margin-bottom:24px;border:1px solid #30363d">
      <div style="font-size:13px;font-weight:800;color:#e6edf3;margin-bottom:14px;letter-spacing:1px">🔄  POWER NODE TRACKER</div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:#8b949e;border-bottom:2px solid #30363d;letter-spacing:0.8px">ENTITY</th>
            <th style="text-align:center;padding:10px 16px;font-size:10px;color:#8b949e;border-bottom:2px solid #30363d;letter-spacing:0.8px">LEVEL</th>
            <th style="text-align:center;padding:10px 16px;font-size:10px;color:#8b949e;border-bottom:2px solid #30363d;letter-spacing:0.8px">HITS</th>
            <th style="text-align:left;padding:10px 16px;font-size:10px;color:#8b949e;border-bottom:2px solid #30363d;letter-spacing:0.8px">CONTEXT</th>
          </tr>
        </thead>
        <tbody>${powerNodes}</tbody>
      </table>
    </div>` : ""}

    <!-- Opportunities -->
    ${opportunities ? `
    <div style="background:#0d1f14;border:1px solid #1b4332;border-radius:16px;padding:24px;margin-bottom:24px">
      <div style="font-size:13px;font-weight:800;color:#3fb950;margin-bottom:14px;letter-spacing:1px">💡  OPPORTUNITIES</div>
      <ul style="margin:0 0 0 16px;padding:0">${opportunities}</ul>
    </div>` : ""}

    <!-- Divider -->
    <div style="text-align:center;margin:12px 0 28px 0">
      <div style="display:inline-block;background:#1e1b4b;color:#a5b4fc;padding:6px 20px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:2px">FULL BRIEFING BELOW</div>
    </div>

    <!-- Full Section Briefing -->
    ${sectionBlocks}

  </div>

  <!-- Footer -->
  <div style="background:#0d1117;border-top:1px solid #30363d;padding:28px;text-align:center">
    <div style="font-size:11px;font-weight:700;color:#818cf8;letter-spacing:2px;text-transform:uppercase">Jeff Intelligence System</div>
    <div style="font-size:11px;color:#8b949e;margin-top:6px">AI: ${esc(DIGEST_MODEL)} · Budget: ${usage.callsUsed}/${usage.maxCalls} calls</div>
    <div style="margin-top:12px;height:3px;width:60px;background:#6366f1;border-radius:2px;display:inline-block"></div>
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
      <td style="padding:16px 20px;border-bottom:1px solid #30363d">
        <div style="font-size:11px;color:#8b949e;margin-bottom:4px">#${i + 1} · ${esc(a.source)}</div>
        <a href="${esc(a.url)}" style="color:#e6edf3;font-weight:700;text-decoration:none;font-size:14px">${esc(a.title)}</a>
        ${a.summary ? `<div style="color:#c9d1d9;font-size:13px;margin-top:4px;line-height:1.5">${esc(a.summary)}</div>` : ""}
      </td>
      <td style="padding:16px 20px;border-bottom:1px solid #30363d;text-align:center;vertical-align:top;white-space:nowrap">
        ${a.importance_score ? `<span style="background:#4338ca;color:#ffffff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">${a.importance_score}/10</span>` : '<span style="color:#6e7681">—</span>'}
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e6edf3">
<div style="max-width:680px;margin:0 auto;overflow:hidden">
  <div style="background:#1e1b4b;color:#fff;padding:36px 28px">
    <div style="font-size:11px;font-weight:700;color:#a5b4fc;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Jeff Intelligence System</div>
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px">Intelligence Digest</div>
    <div style="font-size:13px;color:#c7d2fe;margin-top:6px">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
    <div style="font-size:11px;color:#a5b4fc;margin-top:4px">AI briefing unavailable — top stories only</div>
  </div>
  <div style="background:#0d1117;padding:24px">
    <div style="background:#161b22;border-radius:16px;border:1px solid #30363d;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <tbody>${rows || '<tr><td style="padding:24px;text-align:center;color:#6e7681">No articles today</td></tr>'}</tbody>
      </table>
    </div>
  </div>
  <div style="background:#0d1117;padding:20px 28px;text-align:center;border-top:1px solid #30363d">
    <div style="font-size:11px;color:#6366f1;font-weight:700;letter-spacing:2px">JEFF INTELLIGENCE SYSTEM</div>
    <div style="font-size:11px;color:#a5b4fc;margin-top:4px">AI: ${usage.callsUsed}/${usage.maxCalls} calls</div>
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
    lines.push(`TODAY: ${briefing.one_sentence ?? "No headline available"}`, "");

    lines.push("KEY SIGNALS:");
    for (const s of briefing.key_signals || []) {
      lines.push(`  ${trendIcon(s.trend)} ${s.title} [${s.importance}]`);
      lines.push(`     ${s.category} · ${s.source_count} sources`);
      if (s.summary) lines.push(`     ${s.summary}`);
      if (s.why_it_matters) lines.push(`     → Why it matters: ${s.why_it_matters}`);
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

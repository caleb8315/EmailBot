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
  canMakeAICall,
  getDailyUsageReport,
  recordAICall,
} from "./usage_limiter";
import {
  createOpenAICompatibleClient,
  getModelForWorkload,
  withLLMRetry,
} from "./llm_client";
import { BRIEFING_SECTIONS } from "./types";
import {
  fetchDailyFact,
  fetchDenverWeather,
  fetchEconomicCalendar,
  fetchMarketSnapshot,
  type EconomicEvent,
  type MarketQuote,
  type WeatherData,
} from "./data_feeds";
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

interface DigestEnhancements {
  weather: WeatherData | null;
  marketSnapshot: MarketQuote[];
  economicCalendar: EconomicEvent[];
  dailyFact: string | null;
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

function safeParseJSON(text: string): Record<string, unknown> {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.split("\n", 2).pop()!;
    cleaned = cleaned.replace(/```\s*$/, "").trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Gemini may truncate the response mid-JSON; attempt repair
  }

  let repaired = cleaned;
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }

  if (inString) repaired += '"';
  while (openBrackets > 0) { repaired += "]"; openBrackets--; }
  while (openBraces > 0) { repaired += "}"; openBraces--; }

  try {
    const result = JSON.parse(repaired);
    logger.warn("Recovered truncated JSON from LLM response", {
      originalLength: text.length,
      repairedLength: repaired.length,
    });
    return result;
  } catch (err) {
    logger.error("JSON repair failed", {
      error: err instanceof Error ? err.message : String(err),
      preview: text.slice(0, 200),
    });
    throw new Error(
      `Unterminated JSON from LLM (${text.length} chars); repair also failed`
    );
  }
}

const DIGEST_MODEL = getModelForWorkload("digest");

async function generateBriefing(
  articles: ArticleHistory[],
  sources: SourceRegistry[],
  interests: string[],
  horizon: "daily" | "weekly" = "daily"
): Promise<BriefingData | null> {
  if (articles.length === 0) return null;

  const budgetAvailable = await canMakeAICall("digest");
  if (!budgetAvailable) {
    logger.warn("Digest AI budget exhausted — skipping AI briefing generation");
    return null;
  }

  const openai = createOpenAICompatibleClient();
  if (!openai) {
    logger.warn("No LLM API key — skipping AI briefing");
    return null;
  }

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
  const horizonLabel = horizon === "weekly" ? "the past 7 days" : "today";
  const oneSentenceRule =
    horizon === "weekly"
      ? `- "one_sentence": THE single most important development this week in one punchy sentence that captures both the event and why this week mattered`
      : `- "one_sentence": THE single most important development today in one punchy sentence that captures both the event and its significance`;
  const styleLine =
    horizon === "weekly"
      ? "Write like a senior analyst delivering a weekly recap to a decision-maker. Highlight trend shifts, escalation/de-escalation, and what to watch next week."
      : "Write like a senior analyst briefing a decision-maker. Be specific, analytical, and connect the dots. Avoid filler language.";
  const briefingLabel = horizon === "weekly" ? "weekly recap" : "daily briefing";

  const systemPrompt = `You are an elite intelligence analyst producing a comprehensive ${briefingLabel} for a reader interested in: ${interestsStr}.

Given ${horizonLabel}'s ${articleData.length} articles from ${sourceNames.length} sources, produce a structured intelligence briefing as JSON. The reader wants to UNDERSTAND what is happening and WHY it matters — not just see headlines.

Available sections for categorization: ${sections}

Rules:
${oneSentenceRule}
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

${styleLine}
Return ONLY valid JSON.`;

  try {
    const response = await withLLMRetry("digest_generate_briefing", () =>
      openai.chat.completions.create({
        model: DIGEST_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(articleData) },
        ],
        temperature: 0.4,
        max_tokens: 16000,
      })
    );

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const raw: any = safeParseJSON(content);
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
    await recordAICall("digest");
    logger.info(`AI briefing generated via ${DIGEST_MODEL}`);
    return parsed;
  } catch (err) {
    logger.error("AI briefing generation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Weather HTML Block ──

function buildWeatherHtml(weather: WeatherData | null): string {
  if (!weather) return "";
  return `
  <div style="margin:20px 0;padding:16px 20px;background:#161b22;border:1px solid #30363d;border-radius:12px">
    <div style="font-size:11px;font-weight:800;color:#a5b4fc;letter-spacing:1.5px;margin-bottom:10px">🌤 DENVER WEATHER</div>
    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="vertical-align:middle;padding-right:16px">
        <span style="font-size:36px;line-height:1">${weather.emoji}</span>
      </td>
      <td style="vertical-align:middle">
        <div style="font-size:26px;font-weight:800;color:#e6edf3;line-height:1">${weather.temp}°F</div>
        <div style="font-size:12px;color:#8b949e;margin-top:3px">${esc(weather.condition)} &nbsp;·&nbsp; Feels like ${weather.feelsLike}°F</div>
      </td>
      <td style="vertical-align:middle;text-align:right">
        <div style="font-size:12px;color:#c9d1d9">H: <span style="font-weight:700;color:#f97316">${weather.high}°</span> &nbsp; L: <span style="font-weight:700;color:#60a5fa">${weather.low}°</span></div>
        <div style="font-size:11px;color:#8b949e;margin-top:4px">💨 ${weather.wind} mph &nbsp;·&nbsp; 🌧 ${weather.precipChance}% precip</div>
      </td>
    </tr></table>
  </div>`;
}

function impactLabel(impact: EconomicEvent["impact"]): string {
  if (impact === "high") return "HIGH";
  if (impact === "medium") return "MEDIUM";
  if (impact === "low") return "LOW";
  return "INFO";
}

function buildMarketSnapshotHtml(marketSnapshot: MarketQuote[]): string {
  if (marketSnapshot.length === 0) return "";
  const rows = marketSnapshot
    .map((q) => {
      const isUp = (q.changePercent ?? 0) >= 0;
      const color = isUp ? "#34d399" : "#f87171";
      const sign = isUp ? "+" : "";
      const pct =
        q.changePercent == null
          ? "n/a"
          : `${sign}${q.changePercent.toFixed(2)}%`;
      return `
      <tr>
        <td style="padding:6px 0;font-size:12px;color:#8b949e">${esc(q.label)}</td>
        <td style="padding:6px 0;font-size:13px;font-weight:700;color:#e6edf3;text-align:right">${q.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
        <td style="padding:6px 0 6px 10px;font-size:12px;font-weight:700;color:${color};text-align:right">${esc(pct)}</td>
      </tr>`;
    })
    .join("");
  return `
  <div style="margin:16px 0;padding:14px 20px;background:#161b22;border:1px solid #30363d;border-radius:12px">
    <div style="font-size:11px;font-weight:800;color:#a5b4fc;letter-spacing:1.5px;margin-bottom:8px">📈 MARKET SNAPSHOT</div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
  </div>`;
}

function buildEconomicCalendarHtml(events: EconomicEvent[]): string {
  if (events.length === 0) return "";
  const rows = events
    .map(
      (event) => `
      <div style="margin-bottom:8px;color:#c9d1d9;font-size:12px;line-height:1.5">
        <span style="color:#8b949e">${esc(event.timeLabel)}</span>
        <span style="color:#818cf8;margin-left:6px">${esc(event.country)}</span>
        <span style="margin-left:8px;font-weight:600">${esc(event.event)}</span>
        <span style="margin-left:8px;color:#fbbf24;font-size:10px;font-weight:700">${impactLabel(event.impact)}</span>
      </div>`
    )
    .join("");
  return `
  <div style="margin:16px 0;padding:14px 20px;background:#161b22;border:1px solid #30363d;border-radius:12px">
    <div style="font-size:11px;font-weight:800;color:#a5b4fc;letter-spacing:1.5px;margin-bottom:8px">📅 WHAT TO WATCH TODAY</div>
    ${rows}
  </div>`;
}

function buildDailyFactHtml(dailyFact: string | null): string {
  if (!dailyFact) return "";
  return `
  <div style="margin:18px 0 8px 0;padding:14px 16px;background:#111827;border:1px solid #2b3340;border-radius:10px">
    <div style="font-size:10px;font-weight:800;color:#93c5fd;letter-spacing:1.3px;margin-bottom:6px">💡 DAILY FACT</div>
    <div style="font-size:12px;color:#c9d1d9;line-height:1.5">${esc(dailyFact)}</div>
  </div>`;
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
  usage: UsageReport,
  enhancements: DigestEnhancements = {
    weather: null,
    marketSnapshot: [],
    economicCalendar: [],
    dailyFact: null,
  },
  mode: "daily" | "weekly" = "daily"
): string {
  const { weather, marketSnapshot, economicCalendar, dailyFact } = enhancements;
  const digestTitle =
    mode === "weekly" ? "Weekly Intelligence Recap" : "Daily Intelligence Briefing";
  const oneSentenceLabel =
    mode === "weekly" ? "THIS WEEK IN ONE SENTENCE" : "TODAY IN ONE SENTENCE";
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

  // ── Helpers ──
  const importanceColor = (level: string) =>
    level === "HIGH" ? "#ff6b6b" : level === "MEDIUM" ? "#fbbf24" : "#34d399";
  const sectionDiv = (emoji: string, title: string) =>
    `<div style="font-size:13px;font-weight:800;color:#a5b4fc;letter-spacing:1.2px;margin-top:28px;margin-bottom:14px;padding-top:20px;border-top:1px solid #30363d">${emoji} ${title}</div>`;

  // ── Key Signals ──
  const signalRows = (briefing.key_signals || [])
    .map((s) => {
      const tags = (s.tags || [])
        .map(
          (t) =>
            `<span style="display:inline-block;background:rgba(99,102,241,0.15);color:#818cf8;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600;margin-right:3px">${esc(t)}</span>`
        )
        .join("");
      const summaryLine = s.summary
        ? `<div style="margin-top:6px;font-size:13px;color:#c9d1d9;line-height:1.5">${esc(s.summary)}</div>`
        : "";
      const wimLine = s.why_it_matters
        ? `<div style="margin-top:5px;font-size:12px;color:#a5b4fc;line-height:1.45;padding-left:10px;border-left:2px solid #4338ca">Why it matters: ${esc(s.why_it_matters)}</div>`
        : "";
      return `
      <div style="margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid #21262d">
        <table style="width:100%;border-collapse:collapse"><tr>
          <td style="width:22px;vertical-align:top;padding-right:6px;font-size:13px">➡️</td>
          <td style="vertical-align:top">
            <a href="${esc(s.url)}" style="color:#e6edf3;font-weight:700;text-decoration:none;font-size:14px;line-height:1.35">${esc(s.title)}</a>
            <div style="margin-top:3px;font-size:11px;color:#8b949e">${esc(s.category)} · ${s.source_count} source${s.source_count !== 1 ? "s" : ""} · ${tags}</div>
            ${summaryLine}
            ${wimLine}
          </td>
          <td style="width:55px;vertical-align:top;text-align:right;padding-left:8px">
            <span style="font-size:11px;font-weight:800;color:${importanceColor(s.importance)};letter-spacing:0.5px">${esc(s.importance)}</span>
          </td>
        </tr></table>
      </div>`;
    })
    .join("");

  // ── Market Intelligence ──
  const implications = (briefing.market_intelligence?.implications || [])
    .map((i) => `<div style="margin-bottom:6px;color:#c9d1d9;font-size:13px;line-height:1.55;padding-left:14px">${esc(i)}</div>`)
    .join("");
  const risks = (briefing.market_intelligence?.risk_scenarios || [])
    .map((r) => `<div style="margin-bottom:6px;color:#c9d1d9;font-size:13px;line-height:1.55;padding-left:14px">${esc(r)}</div>`)
    .join("");

  // ── Contrarian Watch ──
  const contrarian = (briefing.contrarian_watch || [])
    .map(
      (c) => `<div style="margin-bottom:8px;color:#c9d1d9;font-size:13px;line-height:1.55;padding-left:14px">• <span style="color:#fbbf24;font-weight:600">${esc(c.narrative)}</span> — ${esc(c.risk_if_wrong)}</div>`
    )
    .join("");

  // ── Blindspots ──
  const blindspots = (briefing.blindspots || [])
    .map(
      (b) =>
        `<div style="margin-bottom:6px;color:#c9d1d9;font-size:13px;line-height:1.55;padding-left:14px">• ${esc(b)}</div>`
    )
    .join("");

  // ── Power Nodes ──
  const powerNodes = (briefing.power_nodes || [])
    .map(
      (p) => `
      <tr>
        <td style="padding:7px 12px;border-bottom:1px solid #21262d;font-weight:700;font-size:12px;color:#e6edf3">${esc(p.entity)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #21262d;text-align:center;font-size:11px;font-weight:700;color:${importanceColor(p.importance)}">${esc(p.importance)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #21262d;text-align:center;font-size:12px;color:#818cf8;font-weight:700">${p.mentions}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #21262d;font-size:11px;color:#8b949e">${esc(p.context)}</td>
      </tr>`
    )
    .join("");

  // ── Opportunities ──
  const opportunities = (briefing.opportunities || [])
    .map(
      (o) =>
        `<div style="margin-bottom:6px;color:#34d399;font-size:13px;line-height:1.55;padding-left:14px">• ${esc(o)}</div>`
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
                `<div style="margin-bottom:4px;color:#c9d1d9;font-size:12px;line-height:1.55;padding-left:14px">• ${esc(b)}</div>`
            )
            .join("");
          const relatedSources = (a.related_sources || [])
            .map((rs) => `<span style="color:#818cf8">${esc(rs)}</span>`)
            .join(`<span style="color:#6e7681"> · </span>`);
          const vBadge = a.verification === "VERIFIED"
            ? '<span style="color:#6ee7b7;font-size:10px;font-weight:700">✓ VERIFIED</span>'
            : a.verification === "DEVELOPING"
            ? '<span style="color:#fcd34d;font-size:10px;font-weight:700">◐ DEVELOPING</span>'
            : '<span style="color:#fca5a5;font-size:10px;font-weight:700">! UNVERIFIED</span>';
          const statusBadge = a.status
            ? `<span style="color:#818cf8;font-size:10px;font-weight:600;margin-left:8px">${esc(a.status)}</span>`
            : "";
          const timeBadge = a.time_label
            ? `<span style="color:#8b949e;font-size:10px;margin-left:8px">🕐 ${esc(a.time_label)}</span>`
            : "";
          return `
          <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #21262d">
            <a href="${esc(a.url)}" style="color:#e6edf3;font-weight:700;text-decoration:none;font-size:13px;line-height:1.4">${esc(a.title)}</a>
            <div style="margin-top:4px;margin-bottom:8px">${vBadge}${statusBadge}${timeBadge}</div>
            ${bullets}
            ${relatedSources ? `<div style="font-size:10px;color:#6e7681;margin-top:8px">Sources: ${relatedSources}</div>` : ""}
          </div>`;
        })
        .join("");
      return `
      ${sectionDiv(sectionIcon(sectionName), sectionName.toUpperCase())}
      ${articleCards}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6edf3">
<div style="max-width:640px;margin:0 auto;padding:36px 28px">

  <div style="text-align:center;padding-bottom:24px;border-bottom:1px solid #30363d">
    <div style="font-size:24px;font-weight:800;color:#e6edf3;letter-spacing:-0.5px">${digestTitle}</div>
    <div style="font-size:13px;color:#8b949e;margin-top:6px">${dateStr} · ${timeStr}</div>
    <div style="font-size:12px;color:#8b949e;margin-top:2px">${sourceCount} sources · ${storyCount} stories · ${sectionCount} sections</div>
    <div style="margin-top:14px;font-size:11px;line-height:2">
      <span style="color:#6ee7b7;margin-right:10px">✓ VERIFIED</span>
      <span style="color:#fcd34d;margin-right:10px">◐ DEVELOPING</span>
      <span style="color:#fca5a5">! UNVERIFIED</span>
    </div>
  </div>

  ${buildWeatherHtml(weather)}
  ${buildMarketSnapshotHtml(marketSnapshot)}
  ${buildEconomicCalendarHtml(economicCalendar)}

  <div style="padding:20px 0">
    <div style="font-size:12px;font-weight:800;color:#a5b4fc;letter-spacing:1.5px;margin-bottom:8px">⚡ ${oneSentenceLabel}</div>
    <div style="font-size:15px;color:#e6edf3;line-height:1.65;font-weight:600">${esc(briefing.one_sentence)}</div>
  </div>

  ${sectionDiv("🧠", "KEY SIGNALS")}
  ${signalRows || '<div style="color:#6e7681;font-size:13px">No signals detected</div>'}

  ${sectionDiv("📊", "MARKET INTELLIGENCE")}
  <div style="font-size:13px;color:#c9d1d9;line-height:1.7;margin-bottom:14px">${esc(briefing.market_intelligence?.analysis || "")}</div>
  ${implications ? `<div style="font-weight:700;font-size:11px;color:#a5b4fc;margin-bottom:8px;letter-spacing:0.5px">IMPLICATIONS</div>${implications}` : ""}
  ${risks ? `<div style="font-weight:700;font-size:11px;color:#ff6b6b;margin-top:14px;margin-bottom:8px;letter-spacing:0.5px">⚠️ RISK SCENARIOS</div>${risks}` : ""}

  ${blindspots ? `${sectionDiv("🚨", "BLINDSPOTS — MISSING COVERAGE")}${blindspots}` : ""}

  ${contrarian ? `${sectionDiv("⚠️", "CONTRARIAN WATCH")}${contrarian}` : ""}

  ${powerNodes ? `${sectionDiv("🔄", "POWER NODE TRACKER")}
  <table style="width:100%;border-collapse:collapse">
    <thead><tr>
      <th style="text-align:left;padding:7px 12px;font-size:10px;color:#8b949e;border-bottom:1px solid #30363d;letter-spacing:0.8px">ENTITY</th>
      <th style="text-align:center;padding:7px 12px;font-size:10px;color:#8b949e;border-bottom:1px solid #30363d;letter-spacing:0.8px">LEVEL</th>
      <th style="text-align:center;padding:7px 12px;font-size:10px;color:#8b949e;border-bottom:1px solid #30363d;letter-spacing:0.8px">HITS</th>
      <th style="text-align:left;padding:7px 12px;font-size:10px;color:#8b949e;border-bottom:1px solid #30363d;letter-spacing:0.8px">CONTEXT</th>
    </tr></thead>
    <tbody>${powerNodes}</tbody>
  </table>` : ""}

  ${opportunities ? `${sectionDiv("💡", "OPPORTUNITIES")}${opportunities}` : ""}

  ${sectionBlocks ? `
  <div style="text-align:center;margin:24px 0 8px 0">
    <span style="font-size:10px;font-weight:800;color:#a5b4fc;letter-spacing:2px">── FULL BRIEFING ──</span>
  </div>
  ${sectionBlocks}` : ""}

  ${buildDailyFactHtml(dailyFact)}

  <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #30363d">
    <div style="font-size:10px;font-weight:700;color:#818cf8;letter-spacing:2px;text-transform:uppercase">Jeff Intelligence System</div>
    <div style="font-size:10px;color:#6e7681;margin-top:4px">AI: ${esc(DIGEST_MODEL)} · Budget: ${usage.callsUsed}/${usage.maxCalls} calls</div>
  </div>

</div>
</body>
</html>`;
}

// ── Fallback HTML (no AI) ──

function buildFallbackHtml(
  topArticles: ArticleHistory[],
  usage: UsageReport,
  enhancements: DigestEnhancements = {
    weather: null,
    marketSnapshot: [],
    economicCalendar: [],
    dailyFact: null,
  },
  mode: "daily" | "weekly" = "daily"
): string {
  const { weather, marketSnapshot, economicCalendar, dailyFact } = enhancements;
  const digestTitle =
    mode === "weekly" ? "Weekly Intelligence Recap" : "Intelligence Digest";
  const subTitle =
    mode === "weekly"
      ? "AI briefing unavailable — weekly top stories only"
      : "AI briefing unavailable — top stories only";
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
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px">${digestTitle}</div>
    <div style="font-size:13px;color:#c7d2fe;margin-top:6px">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
    <div style="font-size:11px;color:#a5b4fc;margin-top:4px">${subTitle}</div>
  </div>
  <div style="background:#0d1117;padding:24px">
    ${buildWeatherHtml(weather)}
    ${buildMarketSnapshotHtml(marketSnapshot)}
    ${buildEconomicCalendarHtml(economicCalendar)}
    <div style="background:#161b22;border-radius:16px;border:1px solid #30363d;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <tbody>${rows || '<tr><td style="padding:24px;text-align:center;color:#6e7681">No articles today</td></tr>'}</tbody>
      </table>
    </div>
    ${buildDailyFactHtml(dailyFact)}
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
  usage: UsageReport,
  enhancements: DigestEnhancements = {
    weather: null,
    marketSnapshot: [],
    economicCalendar: [],
    dailyFact: null,
  },
  mode: "daily" | "weekly" = "daily"
): string {
  const weatherLine = enhancements.weather
    ? `Denver: ${enhancements.weather.emoji} ${enhancements.weather.condition}, ${enhancements.weather.temp}°F (H:${enhancements.weather.high}° L:${enhancements.weather.low}°) · Wind ${enhancements.weather.wind} mph · Precip ${enhancements.weather.precipChance}%`
    : null;
  const marketLine =
    enhancements.marketSnapshot.length > 0
      ? "Markets: " +
        enhancements.marketSnapshot
          .map((q) => {
            const sign = (q.changePercent ?? 0) >= 0 ? "+" : "";
            const pct =
              q.changePercent == null
                ? "n/a"
                : `${sign}${q.changePercent.toFixed(2)}%`;
            return `${q.label} ${pct}`;
          })
          .join(" | ")
      : null;
  const calendarLines =
    enhancements.economicCalendar.length > 0
      ? enhancements.economicCalendar
          .slice(0, 4)
          .map(
            (event) =>
              `${event.timeLabel} ${event.country} ${event.event} [${impactLabel(event.impact)}]`
          )
      : [];
  const lines = [
    mode === "weekly"
      ? "=== WEEKLY INTELLIGENCE RECAP ==="
      : "=== DAILY INTELLIGENCE BRIEFING ===",
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `AI Budget: ${usage.callsUsed}/${usage.maxCalls} calls used`,
    ...(weatherLine ? [weatherLine] : []),
    ...(marketLine ? [marketLine] : []),
    ...(calendarLines.length > 0 ? ["Calendar:"] : []),
    ...calendarLines.map((line) => `  - ${line}`),
    ...(enhancements.dailyFact ? [`Fact: ${enhancements.dailyFact}`] : []),
    "",
  ];

  if (briefing) {
    lines.push(
      `${mode === "weekly" ? "THIS WEEK" : "TODAY"}: ${
        briefing.one_sentence ?? "No headline available"
      }`,
      ""
    );

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

function digestSubject(mode: "daily" | "weekly"): string {
  if (mode === "weekly") {
    const weekStart = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    return `📡 Weekly Intelligence Recap — Week of ${weekStart.toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" }
    )}`;
  }
  return `📡 Daily Intelligence Briefing — ${new Date().toLocaleDateString(
    "en-US",
    { weekday: "short", month: "short", day: "numeric" }
  )}`;
}

async function loadEnhancements(): Promise<DigestEnhancements> {
  const [weatherRes, marketRes, calendarRes, factRes] = await Promise.allSettled([
    fetchDenverWeather(),
    fetchMarketSnapshot(),
    fetchEconomicCalendar(),
    fetchDailyFact(),
  ] as const);

  const pick = <T>(
    result: PromiseSettledResult<T>,
    fallback: T,
    label: string
  ): T => {
    if (result.status === "fulfilled") return result.value;
    logger.warn("Optional enhancement failed", {
      label,
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    });
    return fallback;
  };

  return {
    weather: pick(weatherRes, null, "weather"),
    marketSnapshot: pick(marketRes, [], "markets"),
    economicCalendar: pick(calendarRes, [], "economic_calendar"),
    dailyFact: pick(factRes, null, "daily_fact"),
  };
}

async function sendDigest(
  mode: "daily" | "weekly",
  interests: string[] = []
): Promise<boolean> {
  try {
    logger.info("Building intelligence briefing", { mode });

    if (!digestEmailConfigured() && !digestTelegramConfigured()) {
      logger.error(
        "No digest delivery configured: set SMTP secrets (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_TO) and/or Telegram secrets."
      );
      await logSystemEvent({
        level: "error",
        source: "digest",
        message: `${mode} digest skipped: no delivery channel configured`,
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

    const lookbackHours = mode === "weekly" ? 168 : 24;
    const [recentArticles, sources, usage, enhancements] = await Promise.all([
      getRecentArticles(lookbackHours),
      getSources(),
      getDailyUsageReport(),
      loadEnhancements(),
    ]);

    const topCount = mode === "weekly" ? 30 : 20;
    const topArticles = getTopArticles(recentArticles, topCount);

    logger.info("Digest inputs collected", {
      mode,
      articles: recentArticles.length,
      sources: sources.length,
      lookbackHours,
    });

    const briefing = await generateBriefing(
      recentArticles,
      sources,
      effectiveInterests,
      mode
    );

    const html = briefing
      ? buildBriefingHtml(
          briefing,
          recentArticles,
          sources,
          usage,
          enhancements,
          mode
        )
      : buildFallbackHtml(topArticles, usage, enhancements, mode);
    const text = buildPlainText(briefing, topArticles, usage, enhancements, mode);

    const subject = digestSubject(mode);

    // ── Send email ──
    const transport = createTransport();
    let emailOk = false;
    if (transport) {
      const from = (
        process.env.EMAIL_FROM ||
        process.env.EMAIL_SMTP_USER ||
        process.env.SMTP_USER ||
        ""
      ).trim();
      const to = (process.env.EMAIL_TO || "").trim();
      if (from && to) {
        await transport.sendMail({ from, to, subject, html, text });
        await markEmailed(topArticles.map((a) => a.url));
        logger.info("Digest email sent", { mode, to, articles: topArticles.length });
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
        const topForTg = getTopArticles(recentArticles, mode === "weekly" ? 8 : 6);
        const insight = briefing?.one_sentence || null;
        const plain = formatDigestPlainText(topForTg, usage, insight, {
          mode,
          weather: enhancements.weather,
          marketSnapshot: enhancements.marketSnapshot,
          economicCalendar: enhancements.economicCalendar,
          dailyFact: enhancements.dailyFact,
        });
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
        message: `${mode} digest had no delivery channel`,
      });
      return false;
    }

    const channels: string[] = [];
    if (emailOk) channels.push("email");
    if (telegramOk) channels.push("telegram");

    await saveDigestArchive({
      channels,
      subject,
      html_body: html,
      plain_text: text.slice(0, 120_000),
      article_urls: topArticles.map((a) => a.url),
      meta: {
        mode,
        email_ok: emailOk,
        telegram_ok: telegramOk,
        model: DIGEST_MODEL,
        briefing_generated: Boolean(briefing),
        enhancement_weather: Boolean(enhancements.weather),
        enhancement_markets: enhancements.marketSnapshot.length > 0,
        enhancement_calendar: enhancements.economicCalendar.length > 0,
        enhancement_fact: Boolean(enhancements.dailyFact),
      },
    });

    await logSystemEvent({
      level: "info",
      source: "digest",
      message: `${mode} briefing delivered via ${channels.join(
        " + "
      )} (${DIGEST_MODEL})`,
      meta: { article_count: recentArticles.length, mode },
    });

    logger.info("Digest complete", { mode, channels });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Digest failed", { mode, error: msg });
    await logSystemEvent({
      level: "error",
      source: "digest",
      message: `${mode} digest failed: ${msg}`,
    });
    return false;
  }
}

export async function sendDailyDigest(interests: string[] = []): Promise<boolean> {
  return sendDigest("daily", interests);
}

export async function sendWeeklyDigest(interests: string[] = []): Promise<boolean> {
  return sendDigest("weekly", interests);
}

// ── CLI entry point for GitHub Actions ──
if (process.argv.includes("--daily") || process.argv.includes("--weekly")) {
  const isWeekly = process.argv.includes("--weekly");
  const run = isWeekly ? sendWeeklyDigest : sendDailyDigest;
  run()
    .then((ok) => {
      if (!ok) {
        logger.error(
          `${isWeekly ? "Weekly" : "Daily"} digest failed — check SMTP secrets and LLM key config`
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

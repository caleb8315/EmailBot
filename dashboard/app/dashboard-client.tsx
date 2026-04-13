"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

type Digest = {
  id: string;
  created_at: string;
  channels: string[];
  subject: string | null;
  plain_text: string;
  html_body: string | null;
};

type Ev = {
  id: string;
  created_at: string;
  level: string;
  source: string;
  message: string;
};

type Article = {
  url: string;
  title: string;
  source: string;
  summary: string | null;
  importance_score: number | null;
  credibility_score: number | null;
  alerted: boolean;
  emailed: boolean;
  fetched_at: string;
};

type Run = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
};

type ChatMsg = {
  role: "user" | "bot";
  text: string;
  createdAt: string;
};

type Tab = "overview" | "intel" | "chat" | "preferences";

type BriefingOverlay = {
  boost_categories: string[];
  ignore_categories: string[];
  tier1_keywords: string[];
};

type Preferences = {
  interests: string[];
  dislikes: string[];
  alert_sensitivity: number;
  trusted_sources: string[];
  blocked_sources: string[];
  briefing_overlay: BriefingOverlay;
};

const PREFERENCE_SECTIONS = [
  "World & Geopolitics",
  "Wars & Conflicts",
  "Economy & Markets",
  "Stocks",
  "Crypto",
  "AI & Technology",
  "Power & Elite Activity",
  "Conspiracy / Unverified Signals",
] as const;

const QUICK_INTERESTS = [
  "AI",
  "Macro",
  "Geopolitics",
  "Crypto",
  "Energy",
  "Defense",
  "Semiconductors",
  "Rates",
] as const;

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "recently";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatClock(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function importanceColor(score: number): string {
  if (score >= 8) return "#f87171";
  if (score >= 6) return "#fb923c";
  if (score >= 4) return "#fbbf24";
  return "#34d399";
}

function thumbGradient(seed: string): string {
  const hues = [
    "from-[#00FF41] to-[#00C2FF]",
    "from-[#00C2FF] to-[#050505]",
    "from-[#00FF41] to-[#0a3d1a]",
    "from-[#00C2FF] to-[#00FF41]",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % 997;
  return hues[h % hues.length];
}

function titleInitials(title: string): string {
  const words = title.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizePreferences(raw: unknown): Preferences {
  const data = (raw ?? {}) as Partial<Preferences>;
  const overlay = (data.briefing_overlay ?? {}) as Partial<BriefingOverlay>;
  return {
    interests: dedupeStrings(data.interests ?? []),
    dislikes: dedupeStrings(data.dislikes ?? []),
    alert_sensitivity:
      typeof data.alert_sensitivity === "number" && Number.isFinite(data.alert_sensitivity)
        ? Math.min(10, Math.max(1, Math.round(data.alert_sensitivity)))
        : 5,
    trusted_sources: dedupeStrings(data.trusted_sources ?? []),
    blocked_sources: dedupeStrings(data.blocked_sources ?? []),
    briefing_overlay: {
      boost_categories: dedupeStrings(overlay.boost_categories ?? []),
      ignore_categories: dedupeStrings(overlay.ignore_categories ?? []),
      tier1_keywords: dedupeStrings(overlay.tier1_keywords ?? []),
    },
  };
}

function clonePreferences(prefs: Preferences): Preferences {
  return JSON.parse(JSON.stringify(prefs)) as Preferences;
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 10.8 12 3l9 7.8" />
      <path d="M5.2 9.7V20a1 1 0 0 0 1 1h4v-6h4v6h3.8a1 1 0 0 0 1-1V9.7" />
    </svg>
  );
}

function FeedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
      <circle cx="6" cy="18" r="1.2" />
      <path d="M5 12a7 7 0 0 1 7 7" />
      <path d="M5 7a12 12 0 0 1 12 12" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
      <path d="M5.5 18a2.5 2.5 0 0 1-2.5-2.5V7a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 7v8.5a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3v-3H5.5Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.5 1.5 0 0 1 0 2.1l-1.4 1.4a1.5 1.5 0 0 1-2.1 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9v.2A1.5 1.5 0 0 1 13 22h-2a1.5 1.5 0 0 1-1.5-1.5v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.5 1.5 0 0 1-2.1 0l-1.4-1.4a1.5 1.5 0 0 1 0-2.1l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6h-.2A1.5 1.5 0 0 1 2 13v-2a1.5 1.5 0 0 1 1.5-1.5h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.5 1.5 0 0 1 0-2.1l1.4-1.4a1.5 1.5 0 0 1 2.1 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9v-.2A1.5 1.5 0 0 1 11 2h2a1.5 1.5 0 0 1 1.5 1.5v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.5 1.5 0 0 1 2.1 0l1.4 1.4a1.5 1.5 0 0 1 0 2.1l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2A1.5 1.5 0 0 1 22 11v2a1.5 1.5 0 0 1-1.5 1.5h-.2a1 1 0 0 0-.9.5Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 4v5h-5" />
      <path d="M4 20v-5h5" />
      <path d="M19 9a8 8 0 0 0-13-3M5 15a8 8 0 0 0 13 3" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
      <path d="M15 17l5-5-5-5" />
      <path d="M20 12H9" />
      <path d="M9 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4Z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-[#A3A3A3]/54" stroke="currentColor" strokeWidth="2">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-[#A3A3A3]/54" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M7 12h10m-7 6h4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2">
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("surface-card p-4", className)}>{children}</section>;
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-[#A3A3A3]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[#A3A3A3]/62">{subtitle}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 text-xs font-semibold text-[#00C2FF] transition hover:text-[#00FF41]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function SearchRow({
  value,
  onChange,
  onSubmit,
  placeholder,
  filterSlot,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  filterSlot?: ReactNode;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <form
        className="surface-inset flex min-h-[48px] flex-1 items-center gap-2 px-3 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <SearchIcon />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-[#A3A3A3] placeholder:text-[#A3A3A3]/54 focus:outline-none focus:ring-0"
        />
      </form>
      {filterSlot}
    </div>
  );
}

function TopicPillStrip({
  topics,
  activeLower,
  onSelect,
}: {
  topics: readonly string[];
  activeLower: Set<string>;
  onSelect: (topic: string) => void;
}) {
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {topics.map((topic) => {
        const active = activeLower.has(topic.toLowerCase());
        return (
          <button
            key={topic}
            type="button"
            onClick={() => onSelect(topic)}
            className={cx(
              "shrink-0 snap-start rounded-full border px-3 py-2 text-xs font-medium transition",
              active
                ? "border-[#00FF41]/40 bg-[#00FF41]/12 text-[#A3A3A3]"
                : "border-white/[0.12] bg-[#0c0c0c]/90 text-[#A3A3A3]/88 hover:bg-[#0c0c0c]"
            )}
          >
            {topic}
          </button>
        );
      })}
    </div>
  );
}

function ShortcutRow({
  icon,
  title,
  subtitle,
  onClick,
  dense,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
  dense?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-2xl border border-white/[0.1] bg-[#0c0c0c]/85 text-left shadow-sm transition hover:bg-[#0c0c0c]",
        dense ? "min-h-[44px] px-2.5 py-2" : "min-h-[48px] px-3 py-2.5"
      )}
    >
      <div
        className={cx(
          "flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00C2FF]/14 to-[#00C2FF]/12 text-[#A3A3A3]/88",
          dense ? "h-9 w-9" : "h-10 w-10"
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#A3A3A3]">{title}</p>
        {!dense && subtitle ? (
          <p className="truncate text-xs text-[#A3A3A3]/62">{subtitle}</p>
        ) : null}
      </div>
      <ChevronRightIcon />
    </button>
  );
}

function QuickActionsGrid({
  onPipeline,
  onDaily,
  onWeekly,
}: {
  onPipeline: () => void;
  onDaily: () => void;
  onWeekly: () => void;
}) {
  const actions: Array<{ abbrev: string; label: string; icon: ReactNode; onClick: () => void }> = [
    { abbrev: "Pipeline", label: "Run pipeline workflow", icon: <PlayIcon />, onClick: onPipeline },
    { abbrev: "Daily", label: "Send daily digest email", icon: <MailIcon />, onClick: onDaily },
    { abbrev: "Weekly", label: "Send weekly recap email", icon: <MailIcon />, onClick: onWeekly },
  ];
  return (
    <div className="surface-card p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#A3A3A3]/62">Automations</p>
      <div className="grid grid-cols-3 gap-2">
        {actions.map((a) => (
          <button
            key={a.abbrev}
            type="button"
            title={a.label}
            onClick={a.onClick}
            className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.1] bg-[#0c0c0c]/80 py-2.5 text-center transition hover:bg-[#0c0c0c]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#00FF41]/12 text-[#A3A3A3]/88">
              {a.icon}
            </span>
            <span className="max-w-[4.5rem] text-[10px] font-semibold leading-tight text-[#A3A3A3]">
              {a.abbrev}
            </span>
            <span className="sr-only">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function FeaturedArticleCard({ article }: { article: Article }) {
  const g = thumbGradient(article.url);
  const ini = titleInitials(article.title);
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noreferrer"
      className="w-[196px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0c0c0c]/90 text-left shadow-sm transition hover:border-[#00FF41]/35 hover:shadow-md"
    >
      <div
        className={cx(
          "flex aspect-[16/10] items-center justify-center bg-gradient-to-br text-lg font-bold text-[#050505]",
          g
        )}
      >
        {ini}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 text-sm font-semibold text-[#A3A3A3]">{article.title}</p>
        <p className="mt-1 text-xs text-[#A3A3A3]/62">{article.source}</p>
        {article.importance_score != null && (
          <p className="mt-1 text-[11px] font-medium text-[#A3A3A3]/78">Score {article.importance_score}/10</p>
        )}
      </div>
    </a>
  );
}

function IntelListRow({
  article,
  expanded,
  onToggleExpand,
  accentBorder,
}: {
  article: Article;
  expanded: boolean;
  onToggleExpand: () => void;
  accentBorder?: string;
}) {
  const g = thumbGradient(article.url);
  const ini = titleInitials(article.title);
  return (
    <article
      className={cx(
        "surface-card flex gap-3 overflow-hidden p-3",
        accentBorder && "border-l-[4px] border-[#00FF41]/35"
      )}
      style={accentBorder ? { borderLeftColor: accentBorder } : undefined}
    >
      <div
        className={cx(
          "flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-[#050505]",
          g
        )}
      >
        {ini}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Badge>{article.source}</Badge>
          {article.alerted && <Badge tone="alert">alert</Badge>}
          {article.emailed && <Badge tone="success">emailed</Badge>}
          {article.importance_score != null && (
            <span className="text-[11px] text-[#A3A3A3]/62">imp {article.importance_score}/10</span>
          )}
          {article.credibility_score != null && (
            <span className="text-[11px] text-[#A3A3A3]/62">cred {article.credibility_score}/10</span>
          )}
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold text-[#A3A3A3]">{article.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#A3A3A3]/62">
          <span>{timeAgo(article.fetched_at)}</span>
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-[#00C2FF] hover:text-[#00FF41]"
            onClick={(e) => e.stopPropagation()}
          >
            open <OpenIcon />
          </a>
        </div>
        {article.summary && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-xs font-semibold text-[#00C2FF] hover:text-[#00FF41]"
            >
              {expanded ? "Hide summary" : "Show summary"}
            </button>
            {expanded && (
              <p className="surface-inset mt-2 p-3 text-sm leading-relaxed text-[#A3A3A3]/95">
                {article.summary}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "alert" | "success" | "warn" | "danger";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone === "default" && "border-[#00FF41]/22 bg-[#00FF41]/10 text-[#A3A3A3]",
        tone === "alert" && "border-orange-400/35 bg-orange-500/12 text-orange-200",
        tone === "success" && "border-emerald-400/35 bg-emerald-500/12 text-emerald-200",
        tone === "warn" && "border-yellow-400/35 bg-yellow-500/12 text-yellow-200",
        tone === "danger" && "border-rose-400/35 bg-rose-500/12 text-rose-200"
      )}
    >
      {children}
    </span>
  );
}

function TabButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-[#00FF41]/12 text-[#00FF41]"
          : "text-[#A3A3A3]/58 hover:bg-[#0c0c0c]/80 hover:text-[#00FF41]"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MobileTabButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "relative flex min-h-[52px] flex-col items-center justify-center rounded-2xl px-2 text-[11px] font-semibold transition",
        active ? "text-[#00FF41]" : "text-[#A3A3A3]/58 hover:text-[#00FF41]/90"
      )}
    >
      {active && (
        <span className="absolute top-1 h-1 w-8 rounded-full bg-gradient-to-r from-[#00FF41] to-[#00C2FF]" />
      )}
      <span className={cx("mb-1", active && "mt-1")}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="surface-card border border-white/[0.1] p-2.5 shadow-sm">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-[#A3A3A3]/62">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tracking-tight text-[#A3A3A3]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[#A3A3A3]/62">{hint}</p>}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMsg }) {
  const isUser = message.role === "user";
  return (
    <div className={cx("mb-3 flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cx("flex max-w-[90%] items-end gap-2", isUser && "flex-row-reverse")}>
        {!isUser && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#00FF41] to-[#00C2FF] text-xs font-bold text-[#050505] shadow-md shadow-[#00FF41]/28">
            J
          </div>
        )}
        <div
          className={cx(
            "rounded-2xl px-4 py-3 shadow-md",
            isUser
              ? "rounded-br-md border border-[#00FF41]/25 bg-gradient-to-br from-[#00FF41]/14 to-[#00C2FF]/10 text-[#A3A3A3]"
              : "rounded-bl-md border border-white/[0.12] bg-[#0c0c0c]/95 text-[#A3A3A3]"
          )}
        >
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[#A3A3A3]/62">
            <span>{isUser ? "You" : "Jeff"}</span>
            <span className="text-[#A3A3A3]/54">{formatClock(message.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>
        </div>
      </div>
    </div>
  );
}

function ChipEditor({
  title,
  description,
  value,
  placeholder,
  items,
  onChangeValue,
  onAdd,
  onRemove,
}: {
  title: string;
  description?: string;
  value: string;
  placeholder: string;
  items: string[];
  onChangeValue: (value: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
}) {
  return (
    <Card>
      <h3 className="text-sm font-semibold text-[#A3A3A3]">{title}</h3>
      {description && <p className="mt-1 text-xs text-[#A3A3A3]/62">{description}</p>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          className="input-hybrid h-11 flex-1"
        />
        <button type="button" onClick={onAdd} className="btn-ghost-dark h-11 border-white/[0.12] px-4 text-[#A3A3A3]">
          Add
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length === 0 ? (
          <p className="text-xs text-[#A3A3A3]/62">Nothing added yet.</p>
        ) : (
          items.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onRemove(item)}
              className="inline-flex items-center gap-1 rounded-full border border-[#00FF41]/20 bg-[#00FF41]/8 px-2.5 py-1.5 text-xs font-medium text-[#A3A3A3] transition hover:bg-[#00FF41]/15"
              title="Tap to remove"
            >
              <span>{item}</span>
              <span className="text-sm leading-none">×</span>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

export default function DashboardClient() {
  const [tab, setTab] = useState<Tab>("overview");
  const [digests, setDigests] = useState<Digest[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [feedArticles, setFeedArticles] = useState<Article[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [prefsUserId, setPrefsUserId] = useState("");
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [prefsInitial, setPrefsInitial] = useState<Preferences | null>(null);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState<string | null>(null);
  const [interestInput, setInterestInput] = useState("");
  const [dislikeInput, setDislikeInput] = useState("");
  const [trustedInput, setTrustedInput] = useState("");
  const [blockedInput, setBlockedInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [feedSearch, setFeedSearch] = useState("");
  const [feedSort, setFeedSort] = useState("date");
  const [feedMinScore, setFeedMinScore] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showFullDigest, setShowFullDigest] = useState(false);
  const [overviewSearch, setOverviewSearch] = useState("");
  const [showIntelFilters, setShowIntelFilters] = useState(false);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: "overview", label: "Overview", icon: <HomeIcon /> },
    { id: "intel", label: "Intel", icon: <FeedIcon /> },
    { id: "chat", label: "Chat", icon: <ChatIcon /> },
    { id: "preferences", label: "Prefs", icon: <SettingsIcon /> },
  ];

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const refreshData = useCallback(async () => {
    setLoadErr(null);
    setRunErr(null);
    try {
      const [d, e, a, r, p] = await Promise.all([
        fetch("/api/data/digests"),
        fetch("/api/data/events"),
        fetch("/api/data/articles?limit=30"),
        fetch("/api/github/runs"),
        fetch("/api/data/preferences"),
      ]);
      if (!d.ok || !e.ok || !a.ok || !p.ok) {
        const source = !d.ok ? d : !e.ok ? e : !a.ok ? a : p;
        const payload = await source.json().catch(() => ({}));
        throw new Error(payload.error || source.statusText);
      }

      setDigests((await d.json()).digests || []);
      setEvents((await e.json()).events || []);
      setArticles((await a.json()).articles || []);

      const prefsPayload = await p.json();
      const normalized = normalizePreferences(prefsPayload.preferences);
      setPrefsUserId(prefsPayload.userId || "");
      setPrefs(normalized);
      setPrefsInitial(clonePreferences(normalized));
      setPrefsDirty(false);

      const runsPayload = await r.json().catch(() => ({}));
      if (runsPayload.error) setRunErr(runsPayload.error);
      setRuns(runsPayload.runs || []);
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshFeed = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "200", sort: feedSort });
      if (feedMinScore > 0) params.set("min_importance", String(feedMinScore));
      const res = await fetch(`/api/data/articles?${params}`);
      if (res.ok) {
        const payload = await res.json();
        setFeedArticles(payload.articles || []);
      }
    } catch {
      // Non-blocking feed.
    }
  }, [feedSort, feedMinScore]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (tab === "intel") refreshFeed();
  }, [tab, refreshFeed]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  useEffect(() => {
    setShowFullDigest(false);
  }, [digests[0]?.id]);

  const dispatch = async (workflow: string) => {
    setDispatchMsg(null);
    try {
      const res = await fetch("/api/github/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || payload.detail || res.statusText);
      setDispatchMsg(`Triggered ${workflow}`);
      setTimeout(refreshData, 2000);
    } catch (err) {
      setDispatchMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const sendChat = async () => {
    const message = input.trim();
    if (!message || chatBusy) return;
    setInput("");
    setChat((curr) => [
      ...curr,
      { role: "user", text: message, createdAt: new Date().toISOString() },
    ]);
    setChatBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || res.statusText);
      setChat((curr) => [
        ...curr,
        { role: "bot", text: payload.reply || "(empty)", createdAt: new Date().toISOString() },
      ]);
    } catch (err) {
      setChat((curr) => [
        ...curr,
        {
          role: "bot",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  const toggleExpand = (url: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const mutatePrefs = (mutator: (prev: Preferences) => Preferences) => {
    setPrefs((prev) => {
      if (!prev) return prev;
      const next = normalizePreferences(mutator(prev));
      setPrefsDirty(true);
      return next;
    });
  };

  const addPrefItem = (
    field: "interests" | "dislikes" | "trusted_sources" | "blocked_sources" | "tier1_keywords",
    rawValue: string
  ) => {
    const value = rawValue.trim();
    if (!value) return;
    mutatePrefs((prev) => {
      if (field === "tier1_keywords") {
        return {
          ...prev,
          briefing_overlay: {
            ...prev.briefing_overlay,
            tier1_keywords: dedupeStrings([...prev.briefing_overlay.tier1_keywords, value]),
          },
        };
      }
      return { ...prev, [field]: dedupeStrings([...(prev[field] as string[]), value]) };
    });
  };

  const removePrefItem = (
    field: "interests" | "dislikes" | "trusted_sources" | "blocked_sources" | "tier1_keywords",
    value: string
  ) => {
    mutatePrefs((prev) => {
      if (field === "tier1_keywords") {
        return {
          ...prev,
          briefing_overlay: {
            ...prev.briefing_overlay,
            tier1_keywords: prev.briefing_overlay.tier1_keywords.filter((item) => item !== value),
          },
        };
      }
      return { ...prev, [field]: (prev[field] as string[]).filter((item) => item !== value) };
    });
  };

  const toggleSectionPref = (
    field: "boost_categories" | "ignore_categories",
    section: string
  ) => {
    mutatePrefs((prev) => {
      const boost = new Set(prev.briefing_overlay.boost_categories);
      const ignore = new Set(prev.briefing_overlay.ignore_categories);
      if (field === "boost_categories") {
        boost.has(section) ? boost.delete(section) : boost.add(section);
        ignore.delete(section);
      } else {
        ignore.has(section) ? ignore.delete(section) : ignore.add(section);
        boost.delete(section);
      }
      return {
        ...prev,
        briefing_overlay: {
          ...prev.briefing_overlay,
          boost_categories: [...boost],
          ignore_categories: [...ignore],
        },
      };
    });
  };

  const savePreferences = async () => {
    if (!prefs || prefsSaving) return;
    setPrefsSaving(true);
    setPrefsMsg(null);
    try {
      const res = await fetch("/api/data/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interests: prefs.interests,
          dislikes: prefs.dislikes,
          alert_sensitivity: prefs.alert_sensitivity,
          trusted_sources: prefs.trusted_sources,
          blocked_sources: prefs.blocked_sources,
          briefing_overlay: {
            boost_categories: prefs.briefing_overlay.boost_categories,
            ignore_categories: prefs.briefing_overlay.ignore_categories,
            tier1_keywords: prefs.briefing_overlay.tier1_keywords,
          },
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || res.statusText);
      const normalized = normalizePreferences(payload.preferences);
      setPrefs(normalized);
      setPrefsInitial(clonePreferences(normalized));
      setPrefsDirty(false);
      setPrefsMsg("Preferences saved");
      setTimeout(() => setPrefsMsg(null), 2200);
    } catch (err) {
      setPrefsMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPrefsSaving(false);
    }
  };

  const resetPreferences = () => {
    if (!prefsInitial) return;
    setPrefs(clonePreferences(prefsInitial));
    setPrefsDirty(false);
    setPrefsMsg("Reset unsaved changes");
    setTimeout(() => setPrefsMsg(null), 2200);
  };

  const filteredFeed = useMemo(() => {
    return feedArticles.filter((article) => {
      if (!feedSearch) return true;
      const q = feedSearch.toLowerCase();
      return (
        article.title.toLowerCase().includes(q) ||
        article.source.toLowerCase().includes(q) ||
        (article.summary || "").toLowerCase().includes(q)
      );
    });
  }, [feedArticles, feedSearch]);

  const featuredArticles = useMemo(() => {
    return [...articles]
      .sort((a, b) => {
        const ia = a.importance_score ?? 0;
        const ib = b.importance_score ?? 0;
        if (ib !== ia) return ib - ia;
        return new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime();
      })
      .slice(0, 12);
  }, [articles]);

  const quickInterestActive = useMemo(() => {
    const s = new Set<string>();
    for (const i of prefs?.interests ?? []) s.add(i.toLowerCase());
    return s;
  }, [prefs?.interests]);

  const lastRun = runs[0];
  const articlesToday = articles.filter(
    (article) => new Date(article.fetched_at).toDateString() === new Date().toDateString()
  ).length;
  const alertCount = articles.filter((article) => article.alerted).length;
  const latestDigest = digests[0];
  const latestDigestText = latestDigest?.plain_text ?? "";
  const hasLongDigest = latestDigestText.length > 950;
  const digestSummary = hasLongDigest
    ? `${latestDigestText.slice(0, 950).trimEnd()}\n…`
    : latestDigestText;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_0%,rgba(0,255,65,0.08),transparent_46%),radial-gradient(circle_at_72%_8%,rgba(0,194,255,0.07),transparent_50%),radial-gradient(circle_at_88%_92%,rgba(0,255,65,0.045),transparent_55%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-none flex-col xl:max-w-6xl">
        <header className="sticky top-0 z-40 border-b border-[#00C2FF]/20 bg-[#050505]/90 px-4 py-3 backdrop-blur-xl md:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#00FF41] to-[#00C2FF] text-sm font-bold text-[#050505] shadow-lg shadow-[#00FF41]/28">
                J
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight text-[#A3A3A3]">Jeff Intelligence</p>
                <p className="text-xs text-[#A3A3A3]/58">AI command dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refreshData}
                title="Refresh data"
                className="glass-panel flex h-9 w-9 items-center justify-center rounded-xl text-[#A3A3A3]/58 transition hover:text-[#00FF41]"
              >
                <RefreshIcon />
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                title="Sign out"
                className="glass-panel flex h-9 w-9 items-center justify-center rounded-xl text-[#A3A3A3]/58 transition hover:text-[#00FF41]"
              >
                <LogoutIcon />
              </button>
            </div>
          </div>
        </header>

        <nav className="sticky top-[65px] z-30 hidden border-b border-[#00C2FF]/20 bg-[#050505]/75 px-4 py-2 backdrop-blur-xl md:block md:px-6">
          <div className="flex items-center gap-2">
            {tabs.map((item) => (
              <TabButton
                key={item.id}
                active={tab === item.id}
                label={item.label}
                icon={item.icon}
                onClick={() => setTab(item.id)}
              />
            ))}
          </div>
        </nav>

        <main className="flex-1 space-y-4 px-4 pb-28 pt-4 md:space-y-5 md:px-6 md:pb-8 md:pt-5">
          {loadErr && (
            <div className="surface-card border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {loadErr}
            </div>
          )}

          {tab === "overview" && (
            <>
              <div>
                <p className="bg-gradient-to-r from-[#00FF41] to-[#00C2FF] bg-clip-text text-xs font-semibold uppercase tracking-wider text-transparent">{greeting}</p>
                <h1 className="mt-1 text-xl font-bold tracking-tight text-[#A3A3A3]">Briefing home</h1>
                <p className="mt-1 max-w-sm text-sm text-[#A3A3A3]/54">Search, then open intel or chat.</p>
              </div>

              <SearchRow
                value={overviewSearch}
                onChange={setOverviewSearch}
                onSubmit={() => {
                  setFeedSearch(overviewSearch);
                  setTab("intel");
                }}
                placeholder="Search intel, sources, topics…"
              />

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#A3A3A3]/58">
                  Hot topics
                </p>
                <TopicPillStrip
                  topics={QUICK_INTERESTS}
                  activeLower={quickInterestActive}
                  onSelect={(topic) => {
                    setFeedSearch(topic);
                    setTab("intel");
                  }}
                />
              </div>

              <div className="space-y-2">
                <ShortcutRow dense icon={<FeedIcon />} title="Intel feed" onClick={() => setTab("intel")} />
                <ShortcutRow dense icon={<ChatIcon />} title="Chat with Jeff" onClick={() => setTab("chat")} />
              </div>

              <QuickActionsGrid
                onPipeline={() => dispatch("pipeline.yml")}
                onDaily={() => dispatch("daily_email.yml")}
                onWeekly={() => dispatch("weekly_digest.yml")}
              />
              {dispatchMsg && <p className="text-xs font-medium text-[#00FF41]">{dispatchMsg}</p>}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile
                  label="Pipeline"
                  value={lastRun ? lastRun.conclusion || lastRun.status : "-"}
                  hint={lastRun ? timeAgo(lastRun.created_at) : "No runs yet"}
                />
                <StatTile label="Articles today" value={articlesToday} />
                <StatTile label="Alerts sent" value={alertCount} />
                <StatTile label="Total digests" value={digests.length} />
              </div>

              <Card className="overflow-hidden p-0">
                <div className="h-24 bg-gradient-to-br from-[#00C2FF]/35 via-[#00C2FF]/10 to-[#050505]" />
                <div className="p-4">
                  <SectionHeader title="Latest digest" />
                  {!latestDigest ? (
                    <p className="text-sm text-[#A3A3A3]/62">No digests yet.</p>
                  ) : (
                    <article>
                      <div className="mb-2 flex flex-wrap gap-2">
                        {latestDigest.channels?.map((channel) => (
                          <Badge key={channel} tone={channel === "telegram" ? "success" : "default"}>
                            {channel}
                          </Badge>
                        ))}
                      </div>
                      <h3 className="text-sm font-semibold text-[#A3A3A3]">
                        {latestDigest.subject || "Digest"}
                      </h3>
                      <p className="mt-1 text-xs text-[#A3A3A3]/62">
                        {new Date(latestDigest.created_at).toLocaleString()}
                      </p>
                      <div className="surface-inset mt-3 p-3">
                        <p
                          className={cx(
                            "whitespace-pre-wrap text-sm leading-relaxed text-[#A3A3A3]/95",
                            showFullDigest && "max-h-80 overflow-y-auto pr-1"
                          )}
                        >
                          {showFullDigest ? latestDigestText : digestSummary}
                        </p>
                      </div>
                      {hasLongDigest && (
                        <button
                          type="button"
                          onClick={() => setShowFullDigest((current) => !current)}
                          className="mt-2 text-xs font-semibold text-[#00C2FF] hover:text-[#00FF41]"
                        >
                          {showFullDigest ? "Show shorter preview" : "Read full digest"}
                        </button>
                      )}
                      <p className="mt-1 text-[11px] text-[#A3A3A3]/62">
                        Preview uses saved digest text only (no extra AI calls).
                      </p>
                    </article>
                  )}
                </div>
              </Card>

              <details className="surface-card group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                  <div>
                    <p className="text-sm font-semibold text-[#A3A3A3]">Featured picks &amp; activity</p>
                    <p className="text-xs text-[#A3A3A3]/62">Workflow runs, top articles, and logs</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-[#00C2FF] group-open:hidden">Expand</span>
                  <span className="hidden shrink-0 text-xs font-semibold text-[#00C2FF] group-open:inline">
                    Collapse
                  </span>
                </summary>
                <div className="space-y-4 border-t border-white/[0.08] px-4 pb-4 pt-4">
                  <div>
                    <SectionHeader
                      title="Featured signals"
                      subtitle="Ranked by importance"
                      action={{ label: "View all", onClick: () => setTab("intel") }}
                    />
                    {featuredArticles.length === 0 ? (
                      <p className="text-sm text-[#A3A3A3]/62">No articles yet. Run the pipeline to populate.</p>
                    ) : (
                      <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 pt-1">
                        {featuredArticles.slice(0, 10).map((article) => (
                          <FeaturedArticleCard key={article.url} article={article} />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <SectionHeader title="Workflow activity" subtitle="Recent GitHub runs" />
                      {runErr && <p className="mb-2 text-xs text-rose-300">{runErr}</p>}
                      {runs.length === 0 ? (
                        <p className="text-sm text-[#A3A3A3]/62">No workflow runs yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {runs.slice(0, 8).map((run) => (
                            <div
                              key={run.id}
                              className="surface-inset flex items-center gap-2 px-3 py-2"
                            >
                              <span
                                className={cx(
                                  "h-2.5 w-2.5 shrink-0 rounded-full",
                                  run.status === "completed" && run.conclusion === "success"
                                    ? "bg-emerald-500"
                                    : run.conclusion === "failure"
                                      ? "bg-rose-500"
                                      : "bg-orange-400"
                                )}
                              />
                              <p className="min-w-0 flex-1 truncate text-sm text-[#A3A3A3]">{run.name}</p>
                              <span className="shrink-0 text-xs text-[#A3A3A3]/62">{timeAgo(run.created_at)}</span>
                              <a
                                href={run.html_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.12] px-2 py-1 text-xs text-[#00C2FF] hover:bg-[#0c0c0c]"
                              >
                                open <OpenIcon />
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>

                    <div className="space-y-4">
                      <Card>
                        <SectionHeader title="Recent articles" subtitle="Latest in your briefing" />
                        <div className="space-y-2">
                          {articles.slice(0, 6).length === 0 ? (
                            <p className="text-sm text-[#A3A3A3]/62">No articles yet.</p>
                          ) : (
                            articles.slice(0, 6).map((article) => (
                              <a
                                key={article.url}
                                href={article.url}
                                target="_blank"
                                rel="noreferrer"
                                className="surface-inset block p-3 transition hover:border-[#00FF41]/30 hover:bg-[#00FF41]/6"
                              >
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <Badge>{article.source}</Badge>
                                  {article.alerted && <Badge tone="alert">alert</Badge>}
                                  {article.importance_score != null && (
                                    <span className="text-[11px] text-[#A3A3A3]/62">
                                      imp {article.importance_score}/10
                                    </span>
                                  )}
                                </div>
                                <h3 className="line-clamp-2 text-sm font-medium text-[#A3A3A3]">
                                  {article.title}
                                </h3>
                                <p className="mt-1 text-xs text-[#A3A3A3]/62">{timeAgo(article.fetched_at)}</p>
                              </a>
                            ))
                          )}
                        </div>
                      </Card>

                      <Card>
                        <SectionHeader title="Events & errors" />
                        {events.length === 0 ? (
                          <p className="text-sm text-[#A3A3A3]/62">No events logged yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {events.slice(0, 8).map((event) => (
                              <article key={event.id} className="surface-inset p-3">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge
                                    tone={
                                      event.level === "error"
                                        ? "danger"
                                        : event.level === "warn"
                                          ? "warn"
                                          : "default"
                                    }
                                  >
                                    {event.level}
                                  </Badge>
                                  <Badge>{event.source}</Badge>
                                  <span className="text-xs text-[#A3A3A3]/62">{timeAgo(event.created_at)}</span>
                                </div>
                                <p className="text-sm text-[#A3A3A3]/95">{event.message}</p>
                              </article>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>
                  </div>
                </div>
              </details>
            </>
          )}

          {tab === "intel" && (
            <>
              <Card>
                <SectionHeader title="Intel feed" subtitle="Search and filter live articles" />
                <SearchRow
                  value={feedSearch}
                  onChange={setFeedSearch}
                  onSubmit={() => undefined}
                  placeholder="Search title, source, or summary…"
                  filterSlot={
                    <button
                      type="button"
                      onClick={() => setShowIntelFilters((v) => !v)}
                      title="Filters"
                      className={cx(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border shadow-sm transition",
                        showIntelFilters
                          ? "border-[#00FF41]/50 bg-[#00FF41]/10 text-[#A3A3A3]/95"
                          : "surface-inset border-white/[0.1] bg-[#050505]/70 text-[#A3A3A3]/88 hover:bg-[#00FF41]/6"
                      )}
                    >
                      <FilterIcon />
                    </button>
                  }
                />
                {showIntelFilters && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <select
                      value={feedSort}
                      onChange={(e) => setFeedSort(e.target.value)}
                      className="input-hybrid h-11 text-sm"
                    >
                      <option value="date">Newest</option>
                      <option value="importance">Importance</option>
                    </select>
                    <select
                      value={feedMinScore}
                      onChange={(e) => setFeedMinScore(Number(e.target.value))}
                      className="input-hybrid h-11 text-sm"
                    >
                      <option value="0">All scores</option>
                      <option value="3">3+</option>
                      <option value="5">5+</option>
                      <option value="7">7+</option>
                    </select>
                  </div>
                )}
                <p className="mt-3 text-xs text-[#A3A3A3]/62">
                  {filteredFeed.length} article{filteredFeed.length === 1 ? "" : "s"} found
                </p>
              </Card>

              {filteredFeed.length === 0 ? (
                <Card className="py-10 text-center">
                  <p className="text-sm text-[#A3A3A3]/62">No articles match your filters right now.</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {filteredFeed.map((article) => (
                    <IntelListRow
                      key={article.url}
                      article={article}
                      expanded={expanded.has(article.url)}
                      onToggleExpand={() => toggleExpand(article.url)}
                      accentBorder={importanceColor(article.importance_score ?? 0)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "chat" && (
            <Card className="p-3">
              <SectionHeader
                title="Chat with Jeff"
                subtitle="Ask for timelines, context, and strategic analysis"
              />
              <div className="grid gap-3">
                <div className="surface-inset h-[calc(100dvh-18rem)] min-h-[420px] max-h-[760px] overflow-y-auto p-3">
                  {chat.length === 0 && (
                    <div className="mx-auto mt-16 max-w-sm text-center">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00C2FF]/18 to-[#00C2FF]/12 text-lg text-[#A3A3A3]">
                        ✦
                      </div>
                      <p className="text-sm text-[#A3A3A3]/62">
                        Ask about your latest intelligence, storyline timelines, or key risks to watch.
                      </p>
                    </div>
                  )}
                  {chat.map((message, index) => (
                    <ChatBubble key={`${message.createdAt}-${index}`} message={message} />
                  ))}
                  {chatBusy && (
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#00FF41] to-[#00C2FF] text-xs font-bold text-[#A3A3A3]">
                        J
                      </div>
                      <div className="rounded-2xl rounded-bl-md border border-white/[0.12] bg-[#0c0c0c] px-4 py-3 shadow-sm">
                        <div className="flex gap-1.5">
                          <span className="dot-typing h-2 w-2 rounded-full bg-[#00FF41]/55" />
                          <span
                            className="dot-typing h-2 w-2 rounded-full bg-[#00FF41]/55"
                            style={{ animationDelay: "-0.18s" }}
                          />
                          <span
                            className="dot-typing h-2 w-2 rounded-full bg-[#00FF41]/55"
                            style={{ animationDelay: "-0.34s" }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="surface-inset p-2">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendChat();
                        }
                      }}
                      placeholder="Ask Jeff anything..."
                      disabled={chatBusy}
                      className="input-hybrid max-h-36 min-h-[56px] flex-1 resize-none py-3"
                    />
                    <button
                      type="button"
                      onClick={sendChat}
                      disabled={chatBusy || !input.trim()}
                      className="btn-primary flex h-14 w-14 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <SendIcon />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {tab === "preferences" && (
            <>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-[#A3A3A3]">Personalization profile</h2>
                    <p className="mt-1 text-sm text-[#A3A3A3]/62">
                      Tune your briefing logic, topic priorities, and alert sensitivity.
                    </p>
                    {prefsUserId && <p className="mt-1 text-xs text-[#A3A3A3]/62">Profile: {prefsUserId}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetPreferences}
                      disabled={!prefsDirty || prefsSaving}
                      className="btn-ghost-dark h-10 px-4 text-sm disabled:opacity-40"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={savePreferences}
                      disabled={!prefsDirty || prefsSaving}
                      className="btn-primary h-10 px-4 text-sm disabled:opacity-40"
                    >
                      {prefsSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
                {prefsMsg && <p className="mt-3 text-xs font-medium text-[#00FF41]">{prefsMsg}</p>}
              </Card>

              {!prefs ? (
                <Card className="py-8 text-center">
                  <p className="text-sm text-[#A3A3A3]/62">Loading preferences...</p>
                </Card>
              ) : (
                <>
                  <Card>
                    <SectionHeader title="Alert sensitivity" />
                    <p className="mb-3 text-sm text-[#A3A3A3]/62">
                      Current setting:{" "}
                      <span className="font-semibold text-[#A3A3A3]">{prefs.alert_sensitivity}/10</span>
                    </p>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={prefs.alert_sensitivity}
                      onChange={(e) =>
                        mutatePrefs((prev) => ({
                          ...prev,
                          alert_sensitivity: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-[#00FF41]"
                    />
                    <div className="mt-2 flex justify-between text-xs text-[#A3A3A3]/62">
                      <span>Strict</span>
                      <span>Balanced</span>
                      <span>Wide net</span>
                    </div>
                  </Card>

                  <Card>
                    <SectionHeader title="Quick interests" subtitle="Tap to toggle high-value topics" />
                    <div className="flex flex-wrap gap-2">
                      {QUICK_INTERESTS.map((topic) => {
                        const active = prefs.interests.some(
                          (item) => item.toLowerCase() === topic.toLowerCase()
                        );
                        return (
                          <button
                            key={topic}
                            type="button"
                            onClick={() => {
                              if (active) removePrefItem("interests", topic);
                              else addPrefItem("interests", topic);
                            }}
                            className={cx(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                              active
                                ? "border-[#00FF41]/45 bg-[#00FF41]/10 text-[#A3A3A3]"
                                : "border-white/[0.1] bg-[#0c0c0c]/90 text-[#A3A3A3]/88 hover:border-[#00FF41]/35"
                            )}
                          >
                            {topic}
                          </button>
                        );
                      })}
                    </div>
                  </Card>

                  <ChipEditor
                    title="Interests"
                    value={interestInput}
                    onChangeValue={setInterestInput}
                    onAdd={() => {
                      addPrefItem("interests", interestInput);
                      setInterestInput("");
                    }}
                    onRemove={(item) => removePrefItem("interests", item)}
                    items={prefs.interests}
                    placeholder="Add interest (e.g., trade war)"
                  />

                  <ChipEditor
                    title="Dislikes / lower-priority topics"
                    value={dislikeInput}
                    onChangeValue={setDislikeInput}
                    onAdd={() => {
                      addPrefItem("dislikes", dislikeInput);
                      setDislikeInput("");
                    }}
                    onRemove={(item) => removePrefItem("dislikes", item)}
                    items={prefs.dislikes}
                    placeholder="Add topic to de-prioritize"
                  />

                  <ChipEditor
                    title="Preferred sources"
                    value={trustedInput}
                    onChangeValue={setTrustedInput}
                    onAdd={() => {
                      addPrefItem("trusted_sources", trustedInput);
                      setTrustedInput("");
                    }}
                    onRemove={(item) => removePrefItem("trusted_sources", item)}
                    items={prefs.trusted_sources}
                    placeholder="e.g., reuters.com"
                  />

                  <ChipEditor
                    title="Blocked sources"
                    value={blockedInput}
                    onChangeValue={setBlockedInput}
                    onAdd={() => {
                      addPrefItem("blocked_sources", blockedInput);
                      setBlockedInput("");
                    }}
                    onRemove={(item) => removePrefItem("blocked_sources", item)}
                    items={prefs.blocked_sources}
                    placeholder="e.g., source to mute"
                  />

                  <ChipEditor
                    title="Always-elevate keywords"
                    description="These keywords get additional ranking weight in your briefing."
                    value={keywordInput}
                    onChangeValue={setKeywordInput}
                    onAdd={() => {
                      addPrefItem("tier1_keywords", keywordInput);
                      setKeywordInput("");
                    }}
                    onRemove={(item) => removePrefItem("tier1_keywords", item)}
                    items={prefs.briefing_overlay.tier1_keywords}
                    placeholder="e.g., Taiwan Strait"
                  />

                  <Card>
                    <SectionHeader title="Section boost / mute" />
                    <div className="space-y-2">
                      {PREFERENCE_SECTIONS.map((section) => {
                        const boosted = prefs.briefing_overlay.boost_categories.includes(section);
                        const muted = prefs.briefing_overlay.ignore_categories.includes(section);
                        return (
                          <div
                            key={section}
                            className="surface-inset flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="text-sm text-[#A3A3A3]">{section}</span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => toggleSectionPref("boost_categories", section)}
                                className={cx(
                                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                                  boosted
                                    ? "border-[#00FF41]/45 bg-[#00FF41]/10 text-[#A3A3A3]"
                                    : "border-white/[0.1] bg-[#0c0c0c]/90 text-[#A3A3A3]/88 hover:bg-[#00FF41]/8"
                                )}
                              >
                                Boost
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleSectionPref("ignore_categories", section)}
                                className={cx(
                                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                                  muted
                                    ? "border-[#00FF41]/40 bg-[#00FF41]/10 text-[#A3A3A3]"
                                    : "border-white/[0.1] bg-[#0c0c0c]/90 text-[#A3A3A3]/88 hover:bg-[#00FF41]/8"
                                )}
                              >
                                Mute
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </>
              )}
            </>
          )}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-50 border-t border-[#00C2FF]/25 bg-[#050505]/95 px-4 pt-2 backdrop-blur-2xl md:hidden"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
        >
          <div className="mx-auto grid w-full grid-cols-4 gap-1 xl:max-w-6xl">
            {tabs.map((item) => (
              <MobileTabButton
                key={item.id}
                active={tab === item.id}
                label={item.label}
                icon={item.icon}
                onClick={() => setTab(item.id)}
              />
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

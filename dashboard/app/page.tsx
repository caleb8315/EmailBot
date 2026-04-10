"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

/* ──────────── Types ──────────── */
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

type ChatMsg = { role: "user" | "bot"; text: string };

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

/* ──────────── Helpers ──────────── */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function importanceColor(score: number): string {
  if (score >= 8) return "#f87171";
  if (score >= 6) return "#fbbf24";
  if (score >= 4) return "#8b5cf6";
  return "#636380";
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
      typeof data.alert_sensitivity === "number" &&
      Number.isFinite(data.alert_sensitivity)
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

/* ──────────── Component ──────────── */
export default function Page() {
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

  // Intel feed state
  const [feedSearch, setFeedSearch] = useState("");
  const [feedSort, setFeedSort] = useState("date");
  const [feedMinScore, setFeedMinScore] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Sign out
  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  /* ──── Data fetching ──── */
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
      if (!d.ok) {
        const j = await d.json().catch(() => ({}));
        throw new Error(j.error || d.statusText);
      }
      if (!e.ok) {
        const j = await e.json().catch(() => ({}));
        throw new Error(j.error || e.statusText);
      }
      if (!a.ok) {
        const j = await a.json().catch(() => ({}));
        throw new Error(j.error || a.statusText);
      }
      if (!p.ok) {
        const j = await p.json().catch(() => ({}));
        throw new Error(j.error || p.statusText);
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

      const rj = await r.json();
      if (rj.error) setRunErr(rj.error);
      setRuns(rj.runs || []);
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
        const j = await res.json();
        setFeedArticles(j.articles || []);
      }
    } catch {
      // Feed is non-critical
    }
  }, [feedSort, feedMinScore]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (tab === "intel") refreshFeed();
  }, [tab, refreshFeed]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  /* ──── Actions ──── */
  const dispatch = async (workflow: string) => {
    setDispatchMsg(null);
    try {
      const res = await fetch("/api/github/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || j.detail || res.statusText);
      setDispatchMsg(`Triggered ${workflow}`);
      setTimeout(refreshData, 2000);
    } catch (err) {
      setDispatchMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const sendChat = async () => {
    const t = input.trim();
    if (!t || chatBusy) return;
    setInput("");
    setChat((c) => [...c, { role: "user", text: t }]);
    setChatBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: t }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setChat((c) => [...c, { role: "bot", text: j.reply || "(empty)" }]);
    } catch (err) {
      setChat((c) => [
        ...c,
        { role: "bot", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
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
    field:
      | "interests"
      | "dislikes"
      | "trusted_sources"
      | "blocked_sources"
      | "tier1_keywords",
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
            tier1_keywords: dedupeStrings([
              ...prev.briefing_overlay.tier1_keywords,
              value,
            ]),
          },
        };
      }
      return {
        ...prev,
        [field]: dedupeStrings([...(prev[field] as string[]), value]),
      };
    });
  };

  const removePrefItem = (
    field:
      | "interests"
      | "dislikes"
      | "trusted_sources"
      | "blocked_sources"
      | "tier1_keywords",
    value: string
  ) => {
    mutatePrefs((prev) => {
      if (field === "tier1_keywords") {
        return {
          ...prev,
          briefing_overlay: {
            ...prev.briefing_overlay,
            tier1_keywords: prev.briefing_overlay.tier1_keywords.filter(
              (item) => item !== value
            ),
          },
        };
      }
      return {
        ...prev,
        [field]: (prev[field] as string[]).filter((item) => item !== value),
      };
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
        if (boost.has(section)) boost.delete(section);
        else boost.add(section);
        ignore.delete(section);
      } else {
        if (ignore.has(section)) ignore.delete(section);
        else ignore.add(section);
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
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || res.statusText);
      }
      const normalized = normalizePreferences(json.preferences);
      setPrefs(normalized);
      setPrefsInitial(clonePreferences(normalized));
      setPrefsDirty(false);
      setPrefsMsg("Preferences saved");
      setTimeout(() => setPrefsMsg(null), 2500);
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
    setTimeout(() => setPrefsMsg(null), 2000);
  };

  /* ──── Filtered feed articles ──── */
  const filtered = feedArticles.filter((a) => {
    if (feedSearch) {
      const q = feedSearch.toLowerCase();
      return (
        a.title.toLowerCase().includes(q) ||
        a.source.toLowerCase().includes(q) ||
        (a.summary || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const renderChips = (
    items: string[],
    onRemove: (value: string) => void
  ) => {
    if (items.length === 0) {
      return <p className="muted">None set yet.</p>;
    }
    return (
      <div className="pref-chip-list">
        {items.map((item) => (
          <button
            key={item}
            className="pref-chip"
            onClick={() => onRemove(item)}
            title="Tap to remove"
          >
            <span>{item}</span>
            <span className="chip-x">×</span>
          </button>
        ))}
      </div>
    );
  };

  /* ──── Computed stats ──── */
  const lastRun = runs[0];
  const articlesToday = articles.filter(
    (a) => new Date(a.fetched_at).toDateString() === new Date().toDateString()
  ).length;
  const alertCount = articles.filter((a) => a.alerted).length;

  /* ──────────── Render ──────────── */
  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: "0.9rem", color: "white",
            boxShadow: "0 4px 12px rgba(139,92,246,0.35)",
            letterSpacing: "-0.02em",
          }}>J</div>
          <h1>Jeff Intelligence</h1>
        </div>
        <div className="header-actions">
          <button className="btn-icon" onClick={refreshData} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 8a6.5 6.5 0 0 1 11.3-4.4M14.5 8a6.5 6.5 0 0 1-11.3 4.4" />
              <path d="M13.5 2v3h-3M2.5 14v-3h3" />
            </svg>
          </button>
          <button className="btn-icon" onClick={handleSignOut} title="Sign out">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3M11 11l3-3-3-3M6 8h8" />
            </svg>
          </button>
        </div>
      </header>

      {/* Desktop tabs */}
      <nav className="tab-bar">
        <button
          className={`tab-btn ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          className={`tab-btn ${tab === "intel" ? "active" : ""}`}
          onClick={() => setTab("intel")}
        >
          Intel Feed
        </button>
        <button
          className={`tab-btn ${tab === "chat" ? "active" : ""}`}
          onClick={() => setTab("chat")}
        >
          Chat
        </button>
        <button
          className={`tab-btn ${tab === "preferences" ? "active" : ""}`}
          onClick={() => setTab("preferences")}
        >
          Preferences
        </button>
      </nav>

      {/* Main area */}
      <div className="main-content">
        {loadErr && <div className="error-banner">{loadErr}</div>}

        {/* ════════ OVERVIEW TAB ════════ */}
        {tab === "overview" && (
          <>
            {/* Stats */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Pipeline</div>
                <div className="stat-value" style={{ fontSize: "0.95rem", background: "none", WebkitTextFillColor: "var(--text)" }}>
                  {lastRun ? (
                    <>
                      <span
                        className={`status-dot ${
                          lastRun.status === "completed" && lastRun.conclusion === "success"
                            ? "success"
                            : lastRun.conclusion === "failure"
                              ? "failure"
                              : "running"
                        }`}
                      />
                      {lastRun.conclusion || lastRun.status}
                    </>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Articles today</div>
                <div className="stat-value">{articlesToday}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Alerts sent</div>
                <div className="stat-value">{alertCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total digests</div>
                <div className="stat-value">{digests.length}</div>
              </div>
            </div>

            {/* Actions */}
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => dispatch("pipeline.yml")}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 14 8 5 13" /></svg>
                Run Pipeline
              </button>
              <button className="btn btn-secondary" onClick={() => dispatch("daily_email.yml")}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 4l6 5 6-5" /></svg>
                Daily Digest
              </button>
              <button className="btn btn-secondary" onClick={() => dispatch("weekly_digest.yml")}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h12v10H2z" /><path d="M2 6h12" /><path d="M5 1v4" /><path d="M11 1v4" /></svg>
                Weekly Recap
              </button>
            </div>
            {dispatchMsg && <p className="muted" style={{ marginBottom: "1rem" }}>{dispatchMsg}</p>}

            {/* Recent runs */}
            <div className="section-title">Recent workflow runs</div>
            {runErr && <p className="muted" style={{ marginBottom: "0.5rem" }}>{runErr}</p>}
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              {runs.length === 0 && <p className="muted">No runs yet</p>}
              {runs.slice(0, 8).map((r) => (
                <div key={r.id} className="run-line">
                  <span
                    className={`status-dot ${
                      r.status === "completed" && r.conclusion === "success"
                        ? "success"
                        : r.conclusion === "failure"
                          ? "failure"
                          : "running"
                    }`}
                  />
                  <span>{r.name}</span>
                  <span className="muted" style={{ fontSize: "0.75rem" }}>
                    {timeAgo(r.created_at)}
                  </span>
                  <a href={r.html_url} target="_blank" rel="noreferrer">
                    open
                  </a>
                </div>
              ))}
            </div>

            {/* Recent digest */}
            <div className="section-title">Latest digest</div>
            {digests.length === 0 ? (
              <p className="muted">No digests yet — run the daily or weekly digest workflow.</p>
            ) : (
              <div className="card">
                <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.35rem" }}>
                  {digests[0].channels?.map((c) => (
                    <span
                      key={c}
                      className={`badge ${c === "email" ? "badge-email" : c === "telegram" ? "badge-telegram" : "badge-info"}`}
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="card-title">{digests[0].subject || "Digest"}</div>
                <div className="card-meta">{new Date(digests[0].created_at).toLocaleString()}</div>
                <div className="digest-preview">{digests[0].plain_text.slice(0, 600)}</div>
              </div>
            )}

            {/* Recent articles */}
            <div className="section-title" style={{ marginTop: "1.25rem" }}>
              Recent articles
            </div>
            {articles.slice(0, 8).map((a) => (
              <div key={a.url} className="card">
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem" }}>
                  {a.alerted && <span className="badge badge-alert">alert</span>}
                  {a.emailed && <span className="badge badge-email">emailed</span>}
                  {a.importance_score != null && (
                    <div className="importance-bar">
                      <div className="importance-track">
                        <div
                          className="importance-fill"
                          style={{
                            width: `${(a.importance_score / 10) * 100}%`,
                            background: importanceColor(a.importance_score),
                          }}
                        />
                      </div>
                      <span>{a.importance_score}/10</span>
                    </div>
                  )}
                </div>
                <div className="card-title">{a.title}</div>
                <div className="card-meta">
                  {a.source} &middot; {timeAgo(a.fetched_at)}
                </div>
              </div>
            ))}

            {/* Events */}
            <div className="section-title" style={{ marginTop: "1.25rem" }}>
              Events &amp; errors
            </div>
            {events.length === 0 && <p className="muted">No events logged yet.</p>}
            {events.slice(0, 10).map((x) => (
              <div key={x.id} className="card">
                <span
                  className={`badge ${
                    x.level === "error"
                      ? "badge-error"
                      : x.level === "warn"
                        ? "badge-warn"
                        : "badge-info"
                  }`}
                >
                  {x.level}
                </span>
                <span className="badge badge-info">{x.source}</span>
                <span className="card-meta" style={{ marginLeft: "0.35rem" }}>
                  {timeAgo(x.created_at)}
                </span>
                <div style={{ marginTop: "0.3rem", fontSize: "0.85rem" }}>{x.message}</div>
              </div>
            ))}
          </>
        )}

        {/* ════════ INTEL FEED TAB ════════ */}
        {tab === "intel" && (
          <>
            <div className="feed-filters">
              <input
                type="text"
                placeholder="Search articles..."
                value={feedSearch}
                onChange={(e) => setFeedSearch(e.target.value)}
              />
              <select value={feedSort} onChange={(e) => { setFeedSort(e.target.value); }}>
                <option value="date">Newest first</option>
                <option value="importance">Highest importance</option>
              </select>
              <select
                value={feedMinScore}
                onChange={(e) => setFeedMinScore(Number(e.target.value))}
              >
                <option value="0">All scores</option>
                <option value="3">3+ importance</option>
                <option value="5">5+ importance</option>
                <option value="7">7+ importance</option>
              </select>
            </div>

            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              {filtered.length} article{filtered.length !== 1 ? "s" : ""}
            </p>

            {filtered.length === 0 && (
              <div className="empty-state">
                <p>No articles match your filters</p>
              </div>
            )}

            {filtered.map((a) => (
              <div key={a.url} className="card">
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.3rem" }}>
                  <span className="badge badge-info">{a.source}</span>
                  {a.alerted && <span className="badge badge-alert">alert</span>}
                  {a.emailed && <span className="badge badge-email">emailed</span>}
                  {a.importance_score != null && (
                    <div className="importance-bar">
                      <div className="importance-track">
                        <div
                          className="importance-fill"
                          style={{
                            width: `${(a.importance_score / 10) * 100}%`,
                            background: importanceColor(a.importance_score),
                          }}
                        />
                      </div>
                      <span>{a.importance_score}/10</span>
                    </div>
                  )}
                  {a.credibility_score != null && (
                    <span className="card-meta">cred: {a.credibility_score}/10</span>
                  )}
                </div>
                <div className="card-title">{a.title}</div>
                <div className="card-meta">
                  {timeAgo(a.fetched_at)} &middot;{" "}
                  <a href={a.url} target="_blank" rel="noreferrer">
                    open article
                  </a>
                </div>

                {a.summary && (
                  <>
                    <button className="expand-btn" onClick={() => toggleExpand(a.url)}>
                      {expanded.has(a.url) ? "Hide summary" : "Show summary"}
                    </button>
                    {expanded.has(a.url) && (
                      <div className="article-expand">{a.summary}</div>
                    )}
                  </>
                )}
              </div>
            ))}
          </>
        )}

        {/* ════════ CHAT TAB ════════ */}
        {tab === "chat" && (
          <div className="chat-wrapper">
            <div className="chat-messages">
              {chat.length === 0 && (
                <div className="empty-state">
                  <div style={{
                    width: 48, height: 48, borderRadius: 14,
                    background: "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.1))",
                    border: "1px solid rgba(139,92,246,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 0.75rem", fontSize: "1.25rem",
                  }}>&#x2709;</div>
                  <p>Ask about your digest, articles, preferences, or anything.</p>
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} className={`msg ${m.role === "user" ? "msg-user" : "msg-bot"}`}>
                  <div className="msg-label">
                    {m.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div className="msg-body">{m.text}</div>
                </div>
              ))}
              {chatBusy && (
                <div className="chat-thinking">
                  <div className="dot" />
                  <div className="dot" />
                  <div className="dot" />
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input-row">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                placeholder="Type your message..."
                disabled={chatBusy}
              />
              <button
                className="btn btn-primary"
                onClick={sendChat}
                disabled={chatBusy || !input.trim()}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 1.5l-6 13-2.5-5.5L.5 6.5z" /><path d="M14.5 1.5L6 9" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* ════════ PREFERENCES TAB ════════ */}
        {tab === "preferences" && (
          <>
            <div className="section-title">Interests &amp; personalization</div>
            {!prefs ? (
              <p className="muted">Loading preferences...</p>
            ) : (
              <>
                <div className="card prefs-card">
                  <div className="prefs-header-row">
                    <div>
                      <div className="card-title">Balanced digest profile</div>
                      <div className="card-meta">
                        Used by pipeline + digest selection + briefing prompts.
                      </div>
                      {prefsUserId && (
                        <div className="card-meta">Profile: {prefsUserId}</div>
                      )}
                    </div>
                    <div className="prefs-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={resetPreferences}
                        disabled={!prefsDirty || prefsSaving}
                      >
                        Reset
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={savePreferences}
                        disabled={!prefsDirty || prefsSaving}
                      >
                        {prefsSaving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                  {prefsMsg && (
                    <p className="muted" style={{ marginTop: "0.5rem" }}>
                      {prefsMsg}
                    </p>
                  )}
                  <div className="prefs-control">
                    <label htmlFor="alert-sensitivity">
                      Alert sensitivity: <strong>{prefs.alert_sensitivity}</strong>/10
                    </label>
                    <input
                      id="alert-sensitivity"
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
                    />
                    <div className="prefs-range-labels">
                      <span>Strict</span>
                      <span>Balanced</span>
                      <span>Wide net</span>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">Quick interests</div>
                  <div className="card-meta" style={{ marginBottom: "0.7rem" }}>
                    Tap to quickly add or remove common themes.
                  </div>
                  <div className="pref-chip-list">
                    {QUICK_INTERESTS.map((topic) => {
                      const active = prefs.interests.some(
                        (item) => item.toLowerCase() === topic.toLowerCase()
                      );
                      return (
                        <button
                          key={topic}
                          className={`pref-pill ${active ? "active" : ""}`}
                          onClick={() => {
                            if (active) {
                              removePrefItem("interests", topic);
                            } else {
                              addPrefItem("interests", topic);
                            }
                          }}
                        >
                          {topic}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">Interests</div>
                  <div className="pref-input-row">
                    <input
                      value={interestInput}
                      onChange={(e) => setInterestInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPrefItem("interests", interestInput);
                          setInterestInput("");
                        }
                      }}
                      placeholder="Add interest (e.g., trade war)"
                    />
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        addPrefItem("interests", interestInput);
                        setInterestInput("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {renderChips(prefs.interests, (item) =>
                    removePrefItem("interests", item)
                  )}
                </div>

                <div className="card">
                  <div className="card-title">Dislikes / lower-priority topics</div>
                  <div className="pref-input-row">
                    <input
                      value={dislikeInput}
                      onChange={(e) => setDislikeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPrefItem("dislikes", dislikeInput);
                          setDislikeInput("");
                        }
                      }}
                      placeholder="Add topic to de-prioritize"
                    />
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        addPrefItem("dislikes", dislikeInput);
                        setDislikeInput("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {renderChips(prefs.dislikes, (item) =>
                    removePrefItem("dislikes", item)
                  )}
                </div>

                <div className="card">
                  <div className="card-title">Preferred sources</div>
                  <div className="pref-input-row">
                    <input
                      value={trustedInput}
                      onChange={(e) => setTrustedInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPrefItem("trusted_sources", trustedInput);
                          setTrustedInput("");
                        }
                      }}
                      placeholder="e.g., reuters.com or Bloomberg"
                    />
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        addPrefItem("trusted_sources", trustedInput);
                        setTrustedInput("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {renderChips(prefs.trusted_sources, (item) =>
                    removePrefItem("trusted_sources", item)
                  )}
                </div>

                <div className="card">
                  <div className="card-title">Blocked sources</div>
                  <div className="pref-input-row">
                    <input
                      value={blockedInput}
                      onChange={(e) => setBlockedInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPrefItem("blocked_sources", blockedInput);
                          setBlockedInput("");
                        }
                      }}
                      placeholder="e.g., source you do not trust"
                    />
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        addPrefItem("blocked_sources", blockedInput);
                        setBlockedInput("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {renderChips(prefs.blocked_sources, (item) =>
                    removePrefItem("blocked_sources", item)
                  )}
                </div>

                <div className="card">
                  <div className="card-title">Always-elevate keywords</div>
                  <div className="card-meta" style={{ marginBottom: "0.65rem" }}>
                    These keywords get extra weight in story selection.
                  </div>
                  <div className="pref-input-row">
                    <input
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPrefItem("tier1_keywords", keywordInput);
                          setKeywordInput("");
                        }
                      }}
                      placeholder="e.g., Taiwan Strait"
                    />
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        addPrefItem("tier1_keywords", keywordInput);
                        setKeywordInput("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {renderChips(prefs.briefing_overlay.tier1_keywords, (item) =>
                    removePrefItem("tier1_keywords", item)
                  )}
                </div>

                <div className="card">
                  <div className="card-title">Section boost / mute</div>
                  <div className="card-meta" style={{ marginBottom: "0.7rem" }}>
                    Boosted sections are favored. Muted sections appear only when globally important.
                  </div>
                  <div className="prefs-section-grid">
                    {PREFERENCE_SECTIONS.map((section) => {
                      const boosted = prefs.briefing_overlay.boost_categories.includes(
                        section
                      );
                      const muted = prefs.briefing_overlay.ignore_categories.includes(
                        section
                      );
                      return (
                        <div key={section} className="prefs-section-row">
                          <span>{section}</span>
                          <div className="prefs-toggle-group">
                            <button
                              className={`pref-pill small ${boosted ? "active" : ""}`}
                              onClick={() =>
                                toggleSectionPref("boost_categories", section)
                              }
                            >
                              Boost
                            </button>
                            <button
                              className={`pref-pill small ${muted ? "active muted" : ""}`}
                              onClick={() =>
                                toggleSectionPref("ignore_categories", section)
                              }
                            >
                              Mute
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          <span className="nav-icon">&#x2302;</span>
          Overview
        </button>
        <button className={tab === "intel" ? "active" : ""} onClick={() => setTab("intel")}>
          <span className="nav-icon">&#x2637;</span>
          Intel
        </button>
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
          <span className="nav-icon">&#x2709;</span>
          Chat
        </button>
        <button
          className={tab === "preferences" ? "active" : ""}
          onClick={() => setTab("preferences")}
        >
          <span className="nav-icon">&#x2699;</span>
          Prefs
        </button>
      </nav>
    </div>
  );
}

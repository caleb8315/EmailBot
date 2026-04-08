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

type Tab = "overview" | "intel" | "chat";

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
  if (score >= 8) return "var(--bad)";
  if (score >= 6) return "var(--warn)";
  if (score >= 4) return "var(--accent)";
  return "var(--muted)";
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
      const [d, e, a, r] = await Promise.all([
        fetch("/api/data/digests"),
        fetch("/api/data/events"),
        fetch("/api/data/articles?limit=30"),
        fetch("/api/github/runs"),
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
      setDigests((await d.json()).digests || []);
      setEvents((await e.json()).events || []);
      setArticles((await a.json()).articles || []);

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
        <h1>Jeff Intelligence</h1>
        <div className="header-actions">
          <button className="btn-icon" onClick={refreshData} title="Refresh">
            &#x21bb;
          </button>
          <button className="btn-icon" onClick={handleSignOut} title="Sign out">
            &#x2192;
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
                <div className="stat-value" style={{ fontSize: "0.95rem" }}>
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
              <button className="btn btn-secondary" onClick={() => dispatch("pipeline.yml")}>
                Run pipeline
              </button>
              <button className="btn btn-secondary" onClick={() => dispatch("daily_email.yml")}>
                Run morning digest
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
              <p className="muted">No digests yet — run the morning digest workflow.</p>
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
                Send
              </button>
            </div>
          </div>
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
      </nav>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

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

const LS_KEY = "jeff_intel_dash_secret";

export default function Page() {
  const [secret, setSecret] = useState("");
  const [saved, setSaved] = useState(false);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    const s = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (s) setSecret(s);
  }, []);

  const headers = useCallback(() => {
    const h: Record<string, string> = {};
    if (secret) h["x-dashboard-secret"] = secret;
    return h;
  }, [secret]);

  const saveSecret = () => {
    localStorage.setItem(LS_KEY, secret);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const refreshData = useCallback(async () => {
    setLoadErr(null);
    setRunErr(null);
    try {
      const [d, e, a, r] = await Promise.all([
        fetch("/api/data/digests", { headers: headers() }),
        fetch("/api/data/events", { headers: headers() }),
        fetch("/api/data/articles?limit=30", { headers: headers() }),
        fetch("/api/github/runs", { headers: headers() }),
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
      const dj = await d.json();
      const ej = await e.json();
      const aj = await a.json();
      setDigests(dj.digests || []);
      setEvents(ej.events || []);
      setArticles(aj.articles || []);

      const rj = await r.json();
      if (rj.error) setRunErr(rj.error);
      setRuns(rj.runs || []);
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : String(err));
    }
  }, [headers]);

  useEffect(() => {
    if (secret) refreshData();
  }, [secret, refreshData]);

  const dispatch = async (workflow: string) => {
    setDispatchMsg(null);
    try {
      const res = await fetch("/api/github/dispatch", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ workflow }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || j.detail || res.statusText);
      setDispatchMsg(`Triggered ${workflow} on ${j.ref}`);
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
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ message: t }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setChat((c) => [...c, { role: "bot", text: j.reply || "(empty)" }]);
    } catch (err) {
      setChat((c) => [
        ...c,
        {
          role: "bot",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <div className="layout">
      <header>
        <h1>Jeff Intelligence</h1>
        <p className="muted" style={{ margin: 0, flex: "1 1 200px" }}>
          Digests, pipeline events, GitHub Actions, and the same briefing assistant.
          Monitoring still runs on GitHub Actions — this UI is control + history.
        </p>
        <div className="secret-bar">
          <input
            type="password"
            autoComplete="off"
            placeholder="Dashboard secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <button type="button" onClick={saveSecret}>
            {saved ? "Saved" : "Save"}
          </button>
          <button type="button" onClick={refreshData}>
            Refresh
          </button>
        </div>
      </header>

      {!secret && (
        <p className="muted">
          Set <code>DASHBOARD_SECRET</code> in Vercel env, then enter it here. Never
          commit the secret.
        </p>
      )}

      {loadErr && (
        <p style={{ color: "var(--bad)" }} role="alert">
          {loadErr}
        </p>
      )}

      <div className="grid">
        <section className="panel">
          <h2>Past digests</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Email + Telegram morning runs archived after each success.
          </p>
          {digests.length === 0 && (
            <p className="muted">No archives yet — run the daily digest workflow.</p>
          )}
          {digests.map((x) => (
            <div key={x.id} className="card">
              <div>
                {x.channels?.map((c) => (
                  <span key={c} className={`tag ${c}`}>
                    {c}
                  </span>
                ))}
              </div>
              <time>{new Date(x.created_at).toLocaleString()}</time>
              <div style={{ fontWeight: 600, marginTop: "0.25rem" }}>
                {x.subject || "Digest"}
              </div>
              <pre
                style={{
                  margin: "0.35rem 0 0",
                  fontSize: "0.75rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {x.plain_text.slice(0, 1200)}
                {x.plain_text.length > 1200 ? "…" : ""}
              </pre>
              {x.html_body && (
                <details>
                  <summary className="muted">HTML preview</summary>
                  <iframe
                    className="html-preview"
                    style={{ width: "100%", minHeight: 180, border: "none" }}
                    title="html"
                    srcDoc={x.html_body}
                  />
                </details>
              )}
            </div>
          ))}
        </section>

        <section className="panel">
          <h2>Events &amp; errors</h2>
          {events.length === 0 && (
            <p className="muted">No events logged yet.</p>
          )}
          {events.map((x) => (
            <div key={x.id} className="card">
              <span
                className={`tag ${x.level === "error" ? "error" : x.level === "warn" ? "warn" : "info"}`}
              >
                {x.level}
              </span>
              <span className="tag">{x.source}</span>
              <time> {new Date(x.created_at).toLocaleString()}</time>
              <div style={{ marginTop: "0.25rem" }}>{x.message}</div>
            </div>
          ))}
        </section>

        <section className="panel">
          <h2>GitHub &amp; feed</h2>
          <div className="btn-row">
            <button type="button" onClick={() => dispatch("pipeline.yml")}>
              Run pipeline
            </button>
            <button type="button" onClick={() => dispatch("daily_email.yml")}>
              Run daily digest
            </button>
            <button type="button" onClick={() => dispatch("weekly-briefing.yml")}>
              Run Python briefing
            </button>
          </div>
          {dispatchMsg && (
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              {dispatchMsg}
            </p>
          )}
          <p className="muted" style={{ marginTop: 0 }}>
            Needs <code>GITHUB_TOKEN</code> (workflow scope) +{" "}
            <code>GITHUB_REPO=owner/name</code> in Vercel.
          </p>
          {runErr && <p className="muted">Runs: {runErr}</p>}
          <h2 style={{ marginTop: "1rem" }}>Recent workflow runs</h2>
          {runs.map((r) => (
            <div key={r.id} className="run-line">
              <span
                className={
                  r.status === "completed" && r.conclusion === "success"
                    ? "status-completed"
                    : r.conclusion === "failure"
                      ? "status-failure"
                      : "status-in_progress"
                }
              >
                {r.status}
                {r.conclusion ? ` / ${r.conclusion}` : ""}
              </span>
              <span>{r.name}</span>
              <a href={r.html_url} target="_blank" rel="noreferrer">
                open
              </a>
            </div>
          ))}
          <h2 style={{ marginTop: "1rem" }}>Latest articles</h2>
          {articles.slice(0, 12).map((a) => (
            <div key={a.url} className="card">
              {a.alerted && <span className="tag warn">alert</span>}
              {a.emailed && <span className="tag email">email</span>}
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div className="muted">
                {a.source} · {a.importance_score ?? "—"}/10
              </div>
              <a href={a.url} target="_blank" rel="noreferrer">
                link
              </a>
            </div>
          ))}
        </section>

        <section className="panel chat-panel">
          <h2>Assistant</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Same model as Telegram: your recent stories + preferences. Uses shared
            AI budget.
          </p>
          <div className="chat-messages">
            {chat.length === 0 && (
              <p className="muted">Ask about digest items, story numbers, or prefs.</p>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
                {"\n"}
                {m.text}
              </div>
            ))}
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
              placeholder="Message…"
              disabled={chatBusy || !secret}
            />
            <button type="button" onClick={sendChat} disabled={chatBusy || !secret}>
              Send
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

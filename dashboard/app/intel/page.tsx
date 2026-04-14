"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Belief { id: string; statement: string; confidence: number; evidence_for: number; evidence_against: number; region?: string }
interface Hypothesis { id: string; title: string; status: string; evidence_score: number; description?: string }
interface Arc { id: string; title: string; current_act: string; total_acts?: number; significance: number; next_act_predicted?: string }
interface Dream { id: string; title: string; scenario_type: string; probability: number; impact_level: string; narrative?: string }
interface Prediction { id: string; statement: string; confidence: number; result?: string; created_at: string }
interface Article {
  url: string; title: string; source: string; summary: string | null;
  importance_score: number | null; credibility_score: number | null;
  alerted: boolean; emailed: boolean; fetched_at: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function importanceColor(score: number): string {
  if (score >= 8) return "#f87171";
  if (score >= 6) return "#fb923c";
  if (score >= 4) return "#fbbf24";
  return "#34d399";
}

type Section = "articles" | "beliefs" | "hypos" | "arcs" | "dream" | "predictions";

export default function IntelPage() {
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [section, setSection] = useState<Section>("articles");

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [minScore, setMinScore] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const safeFetch = async (url: string) => {
    try { const r = await fetch(url); if (!r.ok) return {}; return await r.json(); } catch { return {}; }
  };

  const fetchAll = useCallback(async () => {
    const [b, h, a, d, p, art] = await Promise.all([
      safeFetch("/api/intel/beliefs"),
      safeFetch("/api/intel/hypotheses"),
      safeFetch("/api/intel/arcs"),
      safeFetch("/api/intel/dreamtime"),
      safeFetch("/api/intel/predictions"),
      safeFetch("/api/data/articles?limit=200"),
    ]);
    setBeliefs(b.beliefs ?? []);
    setHypotheses(h.hypotheses ?? []);
    setArcs(a.arcs ?? []);
    setDreams(d.scenarios ?? []);
    setPredictions(p.predictions ?? []);
    setArticles(art.articles ?? []);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filteredArticles = useMemo(() => {
    let list = articles;
    if (minScore > 0) list = list.filter(a => (a.importance_score ?? 0) >= minScore);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a => a.title.toLowerCase().includes(q) || a.source.toLowerCase().includes(q) || (a.summary ?? "").toLowerCase().includes(q));
    }
    if (sortBy === "importance") list = [...list].sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0));
    return list;
  }, [articles, search, sortBy, minScore]);

  const toggleExpand = (url: string) => setExpanded(prev => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });

  const sections: { id: Section; label: string; count: number }[] = [
    { id: "articles", label: "Articles", count: articles.length },
    { id: "beliefs", label: "Beliefs", count: beliefs.length },
    { id: "hypos", label: "Hypotheses", count: hypotheses.length },
    { id: "arcs", label: "Arcs", count: arcs.length },
    { id: "dream", label: "Dreamtime", count: dreams.length },
    { id: "predictions", label: "Predictions", count: predictions.length },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200">
      {/* Section tabs */}
      <div className="sticky top-11 z-40 bg-[#050505]/95 backdrop-blur-md border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 flex gap-1 overflow-x-auto py-2 no-scrollbar">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition ${
                section === s.id
                  ? "bg-[#00FF41]/10 text-[#00FF41]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {s.label} {s.count > 0 && <span className="ml-1 text-[9px] opacity-60">{s.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
        {/* ─── Articles ─── */}
        {section === "articles" && (
          <>
            <div className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
              <div className="flex items-stretch gap-2">
                <div className="flex-1 flex items-center gap-2 bg-[#050505] border border-white/10 rounded-lg px-3">
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-gray-500 shrink-0" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search title, source, or summary..."
                    className="flex-1 bg-transparent py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none"
                  />
                </div>
                <button onClick={() => setShowFilters(v => !v)} className={`px-3 rounded-lg border text-xs font-bold transition ${showFilters ? "border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41]" : "border-white/10 text-gray-500 hover:text-gray-300"}`}>
                  Filter
                </button>
              </div>
              {showFilters && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none">
                    <option value="date">Newest</option>
                    <option value="importance">Importance</option>
                  </select>
                  <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none">
                    <option value="0">All scores</option>
                    <option value="3">3+</option>
                    <option value="5">5+</option>
                    <option value="7">7+</option>
                  </select>
                </div>
              )}
              <p className="mt-2 text-[11px] text-gray-600">{filteredArticles.length} article{filteredArticles.length === 1 ? "" : "s"}</p>
            </div>
            {filteredArticles.length === 0 ? (
              <Empty label="No articles match your filters" />
            ) : filteredArticles.map(article => (
              <article key={article.url} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4" style={{ borderLeftWidth: "3px", borderLeftColor: importanceColor(article.importance_score ?? 0) }}>
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[#00FF41]/10 text-gray-300 border border-[#00FF41]/20">{article.source}</span>
                  {article.alerted && <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-orange-500/12 text-orange-200 border border-orange-400/30">alert</span>}
                  {article.emailed && <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-200 border border-emerald-400/30">emailed</span>}
                  {article.importance_score != null && <span className="text-[11px] text-gray-500">imp {article.importance_score}/10</span>}
                  {article.credibility_score != null && <span className="text-[11px] text-gray-500">cred {article.credibility_score}/10</span>}
                </div>
                <h3 className="text-sm font-semibold text-gray-100 leading-snug">{article.title}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{timeAgo(article.fetched_at)}</span>
                  <a href={article.url} target="_blank" rel="noreferrer" className="text-[#00C2FF] hover:text-[#00FF41] font-medium" onClick={e => e.stopPropagation()}>open ↗</a>
                </div>
                {article.summary && (
                  <div className="mt-2">
                    <button onClick={() => toggleExpand(article.url)} className="text-xs font-semibold text-[#00C2FF] hover:text-[#00FF41]">
                      {expanded.has(article.url) ? "Hide summary" : "Show summary"}
                    </button>
                    {expanded.has(article.url) && (
                      <p className="mt-2 bg-[#050505] border border-white/5 rounded-lg p-3 text-sm leading-relaxed text-gray-300">{article.summary}</p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </>
        )}

        {/* ─── Beliefs ─── */}
        {section === "beliefs" && beliefs.map(b => {
          const pct = Math.round(b.confidence * 100);
          const barColor = pct >= 70 ? "#00FF41" : pct >= 40 ? "#fbbf24" : "#f87171";
          return (
            <div key={b.id} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
              <p className="text-sm text-gray-100 leading-relaxed">{b.statement}</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <span className="text-xs font-mono font-bold" style={{ color: barColor }}>{pct}%</span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-500">
                <span>+{b.evidence_for} for</span>
                <span>-{b.evidence_against} against</span>
                {b.region && <span className="ml-auto">{b.region}</span>}
              </div>
            </div>
          );
        })}
        {section === "beliefs" && beliefs.length === 0 && <Empty label="No beliefs tracked yet" />}

        {/* ─── Hypotheses ─── */}
        {section === "hypos" && hypotheses.map(h => (
          <div key={h.id} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                h.status === "active" ? "bg-blue-500/15 text-blue-400" :
                h.status === "watching" ? "bg-yellow-500/15 text-yellow-400" :
                "bg-gray-500/15 text-gray-400"
              }`}>{h.status}</span>
              <div className="flex-1" />
              <span className="text-xs font-mono text-[#00C2FF]">{h.evidence_score}</span>
            </div>
            <p className="text-sm text-gray-100 font-semibold">{h.title}</p>
            {h.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{h.description}</p>}
            <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-[#00C2FF]" style={{ width: `${Math.min(100, h.evidence_score)}%` }} />
            </div>
          </div>
        ))}
        {section === "hypos" && hypotheses.length === 0 && <Empty label="No active hypotheses" />}

        {/* ─── Arcs ─── */}
        {section === "arcs" && arcs.map(a => (
          <div key={a.id} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
            <p className="text-sm text-gray-100 font-semibold">{a.title}</p>
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              <span className="text-purple-400 font-mono font-bold">Act {a.current_act}{a.total_acts ? `/${a.total_acts}` : ""}</span>
              <span className="text-gray-500">Significance: {a.significance}</span>
            </div>
            {a.next_act_predicted && (
              <p className="text-[11px] text-gray-500 mt-1">Next: {a.next_act_predicted}</p>
            )}
          </div>
        ))}
        {section === "arcs" && arcs.length === 0 && <Empty label="No active narrative arcs" />}

        {/* ─── Dreamtime ─── */}
        {section === "dream" && dreams.map(d => {
          const typeColor = d.scenario_type === "wildcard" ? "text-yellow-400" : d.scenario_type === "underrated" ? "text-blue-400" : "text-gray-400";
          return (
            <div key={d.id} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-bold uppercase ${typeColor}`}>{d.scenario_type}</span>
                {d.probability > 0 && <span className="text-[10px] text-gray-500 font-mono">{Math.round(d.probability * 100)}%</span>}
                {d.impact_level && <span className="text-[10px] text-gray-600 ml-auto uppercase">{d.impact_level} impact</span>}
              </div>
              <p className="text-sm text-gray-100 font-semibold">{d.title}</p>
              {d.narrative && <p className="text-xs text-gray-400 mt-2 leading-relaxed line-clamp-3">{d.narrative}</p>}
            </div>
          );
        })}
        {section === "dream" && dreams.length === 0 && <Empty label="No dreamtime scenarios generated" />}

        {/* ─── Predictions ─── */}
        {section === "predictions" && predictions.map(p => (
          <div key={p.id} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
            <p className="text-sm text-gray-100">{p.statement}</p>
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              <span className="text-[#00FF41] font-mono">{Math.round(p.confidence * 100)}%</span>
              {p.result && (
                <span className={`font-bold uppercase ${p.result === "correct" ? "text-green-400" : p.result === "wrong" ? "text-red-400" : "text-gray-500"}`}>
                  {p.result}
                </span>
              )}
              <span className="text-gray-600 ml-auto">{timeAgo(p.created_at)}</span>
            </div>
          </div>
        ))}
        {section === "predictions" && predictions.length === 0 && <Empty label="No predictions recorded" />}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="text-center text-gray-600 text-xs py-12">{label}</div>;
}

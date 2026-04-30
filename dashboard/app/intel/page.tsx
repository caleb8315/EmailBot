"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

interface EvidenceItem { weight?: number; event_id?: string; timestamp?: string; description?: string }
interface Belief { id: string; statement: string; confidence: number; evidence_for: EvidenceItem[] | number; evidence_against: EvidenceItem[] | number; region?: string }
interface Hypothesis { id: string; title: string; status: string; evidence_score: number; description?: string }
interface Arc { id: string; title: string; current_act: string; total_acts?: number; significance: number; next_act_predicted?: string }
interface Dream {
  id: string;
  title: string;
  scenario_type: string;
  probability: number;
  impact_level: string;
  narrative?: string;
  signal_chain?: Array<string | { signal?: string; description?: string }>;
  jeff_probability?: number;
  market_implied_probability?: number;
}
interface Prediction {
  id: string;
  statement: string;
  confidence_at_prediction: number;
  made_at: string;
  resolve_by?: string;
  outcome?: string;
  predictor?: string;
  tags?: string[];
}
interface Article {
  url: string; title: string; source: string; summary: string | null;
  importance_score: number | null; credibility_score: number | null;
  alerted: boolean; emailed: boolean; fetched_at: string;
}

function evidenceCount(val: EvidenceItem[] | number | undefined): number {
  if (typeof val === "number") return val;
  if (Array.isArray(val)) return val.length;
  return 0;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
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
  const [timeFilter, setTimeFilter] = useState<"all" | "today" | "yesterday">("all");
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
    if (timeFilter !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      list = list.filter(a => {
        const d = new Date(a.fetched_at);
        if (isNaN(d.getTime())) return false;
        if (timeFilter === "today") return d >= today;
        return d >= yesterday && d < today;
      });
    }
    if (minScore > 0) list = list.filter(a => (a.importance_score ?? 0) >= minScore);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a => a.title.toLowerCase().includes(q) || a.source.toLowerCase().includes(q) || (a.summary ?? "").toLowerCase().includes(q));
    }
    if (sortBy === "importance") list = [...list].sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0));
    return list;
  }, [articles, search, sortBy, minScore, timeFilter]);

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sections: { id: Section; label: string; count: number }[] = [
    { id: "articles", label: "News Wire", count: articles.length },
    { id: "beliefs", label: "Verified Intel", count: beliefs.length },
    { id: "hypos", label: "Under Investigation", count: hypotheses.length },
    { id: "arcs", label: "Developing Stories", count: arcs.length },
    { id: "dream", label: "What-If Scenarios", count: dreams.length },
    { id: "predictions", label: "Predictions", count: predictions.length },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200">
      {/* Section tabs */}
      <div className="sticky top-11 z-40 bg-[#050505]/95 backdrop-blur-md border-b border-[#00C2FF]/10">
        <div className="max-w-4xl mx-auto px-4 flex gap-1 overflow-x-auto py-2 no-scrollbar">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition ${
                section === s.id
                  ? "bg-[#00C2FF]/10 text-[#00C2FF]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {s.label} {s.count > 0 && <span className="ml-1 text-[9px] opacity-60">{s.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
        {/* ─── Intercepts (Articles) ─── */}
        {section === "articles" && (
          <>
            <div className="bg-[#0c0c0c] border border-[#00C2FF]/10 rounded-xl p-4">
              <div className="flex items-stretch gap-2">
                <div className="flex-1 flex items-center gap-2 bg-[#050505] border border-white/10 rounded-lg px-3">
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-gray-500 shrink-0" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search intercepts, sources, intel..."
                    className="flex-1 bg-transparent py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none"
                  />
                </div>
                <button onClick={() => setShowFilters(v => !v)} className={`px-3 rounded-lg border text-xs font-bold uppercase tracking-wider transition ${showFilters ? "border-[#00C2FF]/30 bg-[#00C2FF]/10 text-[#00C2FF]" : "border-white/10 text-gray-500 hover:text-gray-300"}`}>
                  Filter
                </button>
              </div>
              {showFilters && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mr-2">Time</span>
                    {(["all", "today", "yesterday"] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setTimeFilter(t)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition ${timeFilter === t ? "bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41]/20" : "bg-[#050505] border border-white/10 text-gray-500 hover:text-gray-300"}`}
                      >
                        {t === "all" ? "All" : t}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none">
                      <option value="date">Latest first</option>
                      <option value="importance">Highest priority</option>
                    </select>
                    <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none">
                      <option value="0">All clearance levels</option>
                      <option value="3">Priority 3+</option>
                      <option value="5">Priority 5+</option>
                      <option value="7">Priority 7+</option>
                    </select>
                  </div>
                </div>
              )}
              <p className="mt-2 text-[11px] text-gray-600 font-mono">{filteredArticles.length} INTERCEPT{filteredArticles.length === 1 ? "" : "S"} LOADED</p>
            </div>
            {filteredArticles.length === 0 ? (
              <Empty label="NO NEWS ARTICLES MATCH CURRENT FILTERS" />
            ) : filteredArticles.map(article => (
              <article key={article.url} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4" style={{ borderLeftWidth: "3px", borderLeftColor: importanceColor(article.importance_score ?? 0) }}>
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[#00C2FF]/10 text-[#00C2FF]/80 border border-[#00C2FF]/20">{article.source}</span>
                  {article.alerted && <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-orange-500/12 text-orange-200 border border-orange-400/30">FLAGGED</span>}
                  {article.emailed && <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-200 border border-emerald-400/30">DISPATCHED</span>}
                  {article.importance_score != null && <span className="text-[11px] text-gray-500 font-mono">PRI {article.importance_score}/10</span>}
                  {article.credibility_score != null && <span className="text-[11px] text-gray-500 font-mono">CRED {article.credibility_score}/10</span>}
                </div>
                <h3 className="text-sm font-semibold text-gray-100 leading-snug">{article.title}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{timeAgo(article.fetched_at)}</span>
                  <a href={article.url} target="_blank" rel="noreferrer" className="text-[#00C2FF] hover:text-[#00FF41] font-medium font-mono text-[11px]" onClick={e => e.stopPropagation()}>OPEN SOURCE ↗</a>
                </div>
                {article.summary && (
                  <div className="mt-2">
                    <button onClick={() => toggleExpand(article.url)} className="text-xs font-bold text-[#00C2FF] hover:text-[#00FF41] uppercase tracking-wider">
                      {expanded.has(article.url) ? "Hide Analysis" : "View Analysis"}
                    </button>
                    {expanded.has(article.url) && (
                      <p className="mt-2 bg-[#050505] border border-[#00C2FF]/10 rounded-lg p-3 text-sm leading-relaxed text-gray-300">{article.summary}</p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </>
        )}

        {/* ─── Convictions (Beliefs) ─── */}
        {section === "beliefs" && beliefs.map(b => {
          const pct = Math.round(b.confidence * 100);
          const barColor = pct >= 70 ? "#00FF41" : pct >= 40 ? "#fbbf24" : "#f87171";
          const forCount = evidenceCount(b.evidence_for);
          const againstCount = evidenceCount(b.evidence_against);
          return (
            <div key={b.id} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
              <p className="text-sm text-gray-100 leading-relaxed">{b.statement}</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <span className="text-xs font-mono font-bold" style={{ color: barColor }}>{pct}%</span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-500 font-mono">
                <span className="text-green-400/70">+{forCount} CORROBORATING</span>
                <span className="text-red-400/70">-{againstCount} CONTRADICTING</span>
                {b.region && <span className="ml-auto uppercase">{b.region}</span>}
              </div>
            </div>
          );
        })}
        {section === "beliefs" && beliefs.length === 0 && <Empty label="NO VERIFIED INTEL YET — SYSTEM STILL CROSS-CHECKING SOURCES" />}

        {/* ─── Hypotheses ─── */}
        {section === "hypos" && hypotheses.map(h => (
          <div
            key={h.id}
            className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4 cursor-pointer"
            onClick={() => toggleExpand(h.id)}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full font-mono tracking-wider ${
                h.status === "active" ? "bg-[#00C2FF]/15 text-[#00C2FF]" :
                h.status === "watching" ? "bg-yellow-500/15 text-yellow-400" :
                "bg-gray-500/15 text-gray-400"
              }`}>{h.status}</span>
              <div className="flex-1" />
              <span className="text-xs font-mono text-[#00C2FF]">{h.evidence_score}</span>
              {h.description && (
                <span className="text-[10px] text-gray-600 ml-1">{expanded.has(h.id) ? "▲" : "▼"}</span>
              )}
            </div>
            <p className="text-sm text-gray-100 font-semibold">{h.title}</p>
            {h.description && expanded.has(h.id) && (
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">{h.description}</p>
            )}
            {h.description && !expanded.has(h.id) && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-1">{h.description}</p>
            )}
            <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-[#00C2FF]" style={{ width: `${Math.min(100, h.evidence_score)}%` }} />
            </div>
          </div>
        ))}
        {section === "hypos" && hypotheses.length === 0 && <Empty label="NOTHING UNDER INVESTIGATION — WAITING FOR CONFLICTING SIGNALS" />}

        {/* ─── Story Arcs ─── */}
        {section === "arcs" && arcs.map(a => (
          <div key={a.id} className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
            <p className="text-sm text-gray-100 font-semibold">{a.title}</p>
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              <span className="text-purple-400 font-mono font-bold">ACT {a.current_act}{a.total_acts ? `/${a.total_acts}` : ""}</span>
              <span className="text-gray-500 font-mono">SIGNIFICANCE: {a.significance}</span>
            </div>
            {a.next_act_predicted && (
              <p className="text-[11px] text-gray-500 mt-1 font-mono">NEXT: {a.next_act_predicted}</p>
            )}
          </div>
        ))}
        {section === "arcs" && arcs.length === 0 && <Empty label="NO DEVELOPING STORIES DETECTED — MONITORING FOR PATTERNS" />}

        {/* ─── Projections (Dreamtime / What-If) ─── */}
        {section === "dream" && (
          <>
            {dreams.length > 0 && (
              <div className="flex justify-end">
                <Link href="/dreamtime" className="text-[11px] font-mono text-[#00C2FF] hover:text-[#00FF41] transition-colors">
                  VIEW ALL IN DREAMTIME ↗
                </Link>
              </div>
            )}
            {dreams.map(d => {
              const typeColor = d.scenario_type === "wildcard" ? "text-yellow-400" : d.scenario_type === "underrated" ? "text-[#00C2FF]" : "text-gray-400";
              const isOpen = expanded.has(d.id);
              const pct = d.probability > 0 ? Math.round(d.probability * 100) : null;
              const mktPct = d.market_implied_probability ? Math.round(d.market_implied_probability * 100) : null;
              return (
                <div
                  key={d.id}
                  className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4 cursor-pointer"
                  onClick={() => toggleExpand(d.id)}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-bold uppercase font-mono ${typeColor}`}>{d.scenario_type}</span>
                    {pct !== null && <span className="text-[10px] text-gray-500 font-mono">{pct}% PROBABILITY</span>}
                    {mktPct !== null && (
                      <span className="text-[10px] text-gray-600 font-mono">
                        CONSENSUS: {mktPct}%
                      </span>
                    )}
                    {d.impact_level && <span className="text-[10px] text-gray-600 ml-auto uppercase font-mono">{d.impact_level} IMPACT</span>}
                    <span className="text-[10px] text-gray-600 ml-1">{isOpen ? "▲" : "▼"}</span>
                  </div>
                  <p className="text-sm text-gray-100 font-semibold">{d.title}</p>
                  {isOpen ? (
                    <>
                      {d.narrative && (
                        <p className="text-xs text-gray-400 mt-2 leading-relaxed whitespace-pre-line">{d.narrative}</p>
                      )}
                      {d.signal_chain && d.signal_chain.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/5">
                          <p className="text-[10px] text-gray-500 font-mono mb-2">SIGNAL CHAIN</p>
                          <div className="space-y-1">
                            {d.signal_chain.map((signal, i) => (
                              <p key={i} className="text-[10px] text-gray-500">
                                {i + 1}. {typeof signal === "string" ? signal : signal.description || signal.signal || JSON.stringify(signal)}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    d.narrative && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.narrative}</p>
                  )}
                </div>
              );
            })}
            {dreams.length === 0 && <Empty label="NO WHAT-IF SCENARIOS GENERATED — RUN DREAMTIME TO SIMULATE" />}
          </>
        )}

        {/* ─── Forecasts (Predictions) ─── */}
        {section === "predictions" && (
          <>
            {predictions.length > 0 && (
              <div className="flex justify-end">
                <Link href="/predictions" className="text-[11px] font-mono text-[#00FF41] hover:text-[#00C2FF] transition-colors">
                  MANAGE PREDICTIONS ↗
                </Link>
              </div>
            )}
            {predictions.map(p => {
              const isOpen = expanded.has(p.id);
              const confidence = p.confidence_at_prediction ?? (p as unknown as { confidence?: number }).confidence ?? 0;
              const madeAt = p.made_at ?? (p as unknown as { created_at?: string }).created_at ?? "";
              const outcome = p.outcome ?? (p as unknown as { result?: string }).result;
              return (
                <div
                  key={p.id}
                  className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4 cursor-pointer"
                  onClick={() => toggleExpand(p.id)}
                >
                  <p className="text-sm text-gray-100">{p.statement}</p>
                  <div className="mt-2 flex items-center gap-3 text-[11px] font-mono flex-wrap">
                    <span className="text-[#00FF41]">{Math.round(confidence * 100)}% CONFIDENCE</span>
                    {outcome && (
                      <span className={`font-bold uppercase ${
                        outcome === "correct" ? "text-green-400" :
                        outcome === "incorrect" ? "text-red-400" :
                        outcome === "partial" ? "text-yellow-400" :
                        "text-gray-500"
                      }`}>
                        {outcome === "correct" ? "VERIFIED" : outcome === "incorrect" ? "DISPROVEN" : outcome.toUpperCase()}
                      </span>
                    )}
                    {p.predictor && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 uppercase">{p.predictor}</span>
                    )}
                    <span className="text-gray-600 ml-auto">{timeAgo(madeAt)}</span>
                    <span className="text-gray-600">{isOpen ? "▲" : "▼"}</span>
                  </div>
                  {isOpen && (
                    <div className="mt-3 border-t border-white/5 pt-3 space-y-1.5 text-[11px] font-mono text-gray-500">
                      {p.resolve_by && (
                        <p className={new Date(p.resolve_by) < new Date() ? "text-orange-400" : ""}>
                          {new Date(p.resolve_by) < new Date() ? "⚠ OVERDUE — " : "RESOLVES BY "}
                          {new Date(p.resolve_by).toLocaleDateString()}
                        </p>
                      )}
                      {p.tags && p.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {p.tags.map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-white/5">{tag}</span>
                          ))}
                        </div>
                      )}
                      <Link
                        href="/predictions"
                        className="inline-block text-[#00FF41] hover:text-[#00C2FF] transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        Resolve this prediction →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
            {predictions.length === 0 && <Empty label="NO PREDICTIONS YET — NEEDS MORE DATA TO PROJECT OUTCOMES" />}
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="text-center text-gray-600 text-xs py-12 font-mono tracking-wider">{label}</div>;
}

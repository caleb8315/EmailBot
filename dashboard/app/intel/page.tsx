"use client";

import { useCallback, useEffect, useState } from "react";

interface Belief { id: string; statement: string; confidence: number; evidence_for: number; evidence_against: number; region?: string }
interface Hypothesis { id: string; title: string; status: string; evidence_score: number; description?: string }
interface Arc { id: string; title: string; current_act: string; total_acts?: number; significance: number; next_act_predicted?: string }
interface Dream { id: string; title: string; scenario_type: string; probability: number; impact_level: string; narrative?: string }
interface Prediction { id: string; statement: string; confidence: number; result?: string; created_at: string }

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function IntelPage() {
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [section, setSection] = useState<"beliefs" | "hypos" | "arcs" | "dream" | "predictions">("beliefs");

  const safeFetch = async (url: string) => {
    try {
      const r = await fetch(url);
      if (!r.ok) return {};
      return await r.json();
    } catch { return {}; }
  };

  const fetchAll = useCallback(async () => {
    const [b, h, a, d, p] = await Promise.all([
      safeFetch("/api/intel/beliefs"),
      safeFetch("/api/intel/hypotheses"),
      safeFetch("/api/intel/arcs"),
      safeFetch("/api/intel/dreamtime"),
      safeFetch("/api/intel/predictions"),
    ]);
    setBeliefs(b.beliefs ?? []);
    setHypotheses(h.hypotheses ?? []);
    setArcs(a.arcs ?? []);
    setDreams(d.scenarios ?? []);
    setPredictions(p.predictions ?? []);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const sections = [
    { id: "beliefs" as const, label: "Beliefs", count: beliefs.length },
    { id: "hypos" as const, label: "Hypotheses", count: hypotheses.length },
    { id: "arcs" as const, label: "Arcs", count: arcs.length },
    { id: "dream" as const, label: "Dreamtime", count: dreams.length },
    { id: "predictions" as const, label: "Predictions", count: predictions.length },
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
        {/* Beliefs */}
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

        {/* Hypotheses */}
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

        {/* Arcs */}
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

        {/* Dreamtime */}
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

        {/* Predictions */}
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

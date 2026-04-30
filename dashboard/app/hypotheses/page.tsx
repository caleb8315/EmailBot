"use client";

import { useEffect, useState } from "react";

interface Hypothesis {
  id: string;
  title: string;
  confidence: number;
  prior_confidence: number;
  confidence_history: { timestamp: string; confidence: number; reason: string }[];
  supporting_signals: string[];
  undermining_signals: string[];
  status: string;
  region?: string;
  tags: string[];
  last_updated: string;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function confidenceLabel(pct: number): { text: string; color: string } {
  if (pct >= 70) return { text: "Jeff strongly believes this", color: "text-green-400" };
  if (pct >= 50) return { text: "Jeff leans toward this being true", color: "text-[#00FF41]" };
  if (pct >= 30) return { text: "Jeff is uncertain — evidence is mixed", color: "text-yellow-400" };
  return { text: "Jeff doubts this — more evidence against it", color: "text-red-400" };
}

function humanizeReason(reason: string): string {
  // Clean up event type codes into readable text
  return reason
    .replace(/military_flight_isr/g, "ISR surveillance flight")
    .replace(/military_flight/g, "military flight")
    .replace(/procurement_munitions/g, "munitions procurement")
    .replace(/procurement_medical/g, "medical supply procurement")
    .replace(/procurement_interpreters/g, "interpreter contract")
    .replace(/vessel_dark/g, "ship went dark on tracking")
    .replace(/internet_shutdown/g, "internet shutdown")
    .replace(/prediction_market_spike/g, "prediction market movement")
    .replace(/narrative_cluster/g, "coordinated narrative cluster")
    .replace(/doomsday_plane/g, "nuclear command aircraft")
    .replace(/hospital_ship_movement/g, "hospital ship deployment")
    .replace(/tanker_surge/g, "fuel tanker surge")
    .replace(/notam_closure/g, "airspace closure (NOTAM)")
    .replace(/_/g, " ");
}

export default function HypothesesPage() {
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/intel/hypotheses")
      .then(r => r.ok ? r.json() : { hypotheses: [] })
      .then(d => setHypotheses(d.hypotheses || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="text-[#00FF41] font-mono animate-pulse text-sm">Loading theories...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <h1 className="text-xl font-bold text-gray-100">Under Investigation</h1>
        <p className="text-sm text-gray-500 mt-1">
          Theories Jeff is weighing. Each one gets stronger or weaker as new signals come in.
        </p>
      </div>

      <div className="max-w-2xl mx-auto px-4 space-y-3">
        {hypotheses.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No active theories right now.</p>
            <p className="text-gray-600 text-xs mt-2">They form automatically when signals start clustering around an unconfirmed event.</p>
          </div>
        ) : hypotheses.map(h => {
          const pct = Math.round(h.confidence * 100);
          const priorPct = Math.round(h.prior_confidence * 100);
          const delta = pct - priorPct;
          const isOpen = expanded === h.id;
          const label = confidenceLabel(pct);
          const barColor = pct >= 70 ? "#00FF41" : pct >= 50 ? "#00FF41" : pct >= 30 ? "#EAB308" : "#EF4444";
          const recentHistory = (h.confidence_history || []).slice(-5).reverse();

          return (
            <div
              key={h.id}
              className="bg-[#0c0c0c] border border-white/8 rounded-2xl overflow-hidden"
            >
              <button
                className="w-full p-4 text-left"
                onClick={() => setExpanded(isOpen ? null : h.id)}
              >
                {/* Title */}
                <p className="text-sm font-semibold text-gray-100 leading-snug pr-6">{h.title}</p>

                {/* Confidence bar */}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                  <span className="text-sm font-bold font-mono shrink-0" style={{ color: barColor }}>{pct}%</span>
                </div>

                {/* Plain-English confidence label + delta */}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={`text-xs ${label.color}`}>{label.text}</span>
                  {delta !== 0 && (
                    <span className={`text-xs font-mono shrink-0 ${delta > 0 ? "text-green-400" : "text-red-400"}`}>
                      {delta > 0 ? `▲ +${delta}%` : `▼ ${delta}%`} since start
                    </span>
                  )}
                </div>

                {/* Signal counts */}
                <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                  <span className="text-green-400/80">{h.supporting_signals?.length || 0} signals support this</span>
                  <span className="text-red-400/80">{h.undermining_signals?.length || 0} signals push back</span>
                  {h.region && <span className="ml-auto text-gray-600 uppercase text-[10px]">{h.region}</span>}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-white/5 px-4 pb-4 pt-3 space-y-4">
                  {/* What this means */}
                  <div className="bg-[#050505] border border-white/5 rounded-xl p-3">
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-1">What this means</p>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      Jeff is tracking whether <span className="text-gray-100 font-medium">&ldquo;{h.title}&rdquo;</span> is actually happening.
                      The {pct}% confidence means he thinks there&apos;s a {pct}-in-100 chance this theory is correct based on current signals.
                      {delta > 0 ? " It\u2019s trending up \u2014 new evidence is supporting it." :
                       delta < 0 ? " It\u2019s trending down \u2014 recent signals are contradicting it." :
                       " Confidence hasn\u2019t moved much yet."}
                    </p>
                  </div>

                  {/* Recent evidence */}
                  {recentHistory.length > 0 && (
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-2">What moved the needle</p>
                      <div className="space-y-2">
                        {recentHistory.map((entry, i) => {
                          const isUp = i < recentHistory.length - 1
                            ? entry.confidence > recentHistory[i + 1].confidence
                            : entry.confidence > h.prior_confidence;
                          return (
                            <div key={i} className="flex items-start gap-2">
                              <span className={`text-xs mt-0.5 shrink-0 ${isUp ? "text-green-400" : "text-red-400"}`}>
                                {isUp ? "▲" : "▼"}
                              </span>
                              <div className="flex-1">
                                <p className="text-xs text-gray-300">{humanizeReason(entry.reason)}</p>
                                <p className="text-[10px] text-gray-600 mt-0.5">
                                  Moved to {Math.round(entry.confidence * 100)}% · {timeAgo(entry.timestamp)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {h.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {h.tags.map(t => (
                        <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500 capitalize">{t.replace(/_/g, " ")}</span>
                      ))}
                    </div>
                  )}

                  <p className="text-[10px] text-gray-600">Last updated {timeAgo(h.last_updated)}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

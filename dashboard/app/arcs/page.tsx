"use client";

import { useEffect, useState } from "react";

interface ArcAct {
  act: number;
  title: string;
  description: string;
  started_at?: string;
}

interface NarrativeArc {
  id: string;
  title: string;
  current_act: number;
  total_acts?: number;
  act_descriptions: ArcAct[];
  pattern_matched?: string;
  historical_accuracy?: number;
  next_act_predicted?: string;
  next_act_median_hours?: number;
  region?: string;
  status: string;
  started_at: string;
  last_updated: string;
}

const PATTERN_DESCRIPTIONS: Record<string, { what: string; example: string }> = {
  pre_operational_posture: {
    what: "Multiple military signals — surveillance flights, tanker surges, ships going dark — firing together in a short window. Historically precedes a military operation.",
    example: "Similar patterns appeared before the 2022 Ukraine invasion and the 2020 Nagorno-Karabakh war.",
  },
  internet_blackout_conflict: {
    what: "An internet shutdown coinciding with military activity. Governments cut connectivity when they don't want reporting of what's happening on the ground.",
    example: "Seen before military operations in Ethiopia, Myanmar, and Sudan.",
  },
  sanctions_evasion_detected: {
    what: "Ships disabling their tracking (going 'dark') near sanctioned countries — a common technique for transferring oil, weapons, or goods.",
    example: "Used extensively by North Korea, Iran, and Russia to move sanctioned cargo.",
  },
  prediction_market_insider: {
    what: "Betting odds on a political or military outcome shifted sharply before any public news — suggesting informed traders acting on non-public information.",
    example: "Markets moved ahead of several major political announcements historically.",
  },
  io_campaign_detected: {
    what: "Three or more unrelated outlets started pushing the same specific narrative at once — a hallmark of coordinated information operations.",
    example: "Pattern matches campaigns documented by EU DisinfoLab and Stanford Internet Observatory.",
  },
  hospital_ship_deployment: {
    what: "A military hospital ship moved far from home port. These slow vessels must pre-position weeks before expected casualties.",
    example: "USNS Comfort/Mercy deployments have preceded major US operations.",
  },
  procurement_surge: {
    what: "Unusual spike in government contracts for munitions, medical supplies, or interpreters — the purchases that quietly happen before troops deploy.",
    example: "SAM.gov procurement surges have preceded deployments to multiple conflict zones.",
  },
  doomsday_activation: {
    what: "Nuclear command aircraft (E-4B or E-6) detected airborne. These carry launch authority and only fly during exercises or elevated readiness.",
    example: "Activations have correlated with major geopolitical crises and exercises.",
  },
};

function formatDuration(hours: number): string {
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} days`;
  return `${Math.round(days / 7)} weeks`;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days}d ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

export default function ArcsPage() {
  const [arcs, setArcs] = useState<NarrativeArc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/intel/arcs")
      .then(r => r.ok ? r.json() : { arcs: [] })
      .then(d => setArcs(d.arcs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="text-[#00FF41] font-mono animate-pulse text-sm">Loading stories...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <h1 className="text-xl font-bold text-gray-100">Developing Stories</h1>
        <p className="text-sm text-gray-500 mt-1">
          Events Jeff is tracking that follow a recognizable historical pattern — like a story unfolding in acts.
        </p>
      </div>

      <div className="max-w-2xl mx-auto px-4 space-y-5">
        {arcs.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No developing stories right now.</p>
            <p className="text-gray-600 text-xs mt-2">They form when a sequence of real-world signals matches a historical crisis pattern.</p>
          </div>
        ) : arcs.map(arc => {
          const patternInfo = arc.pattern_matched ? PATTERN_DESCRIPTIONS[arc.pattern_matched] : null;
          const progress = arc.total_acts ? Math.round((arc.current_act / arc.total_acts) * 100) : null;

          return (
            <div key={arc.id} className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-100 leading-snug">{arc.title.replace(/_/g, " ")}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {arc.region && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500">{arc.region}</span>
                    )}
                    <span className="text-[11px] text-gray-600">Started {timeAgo(arc.started_at)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-[#00C2FF]">Act {arc.current_act}{arc.total_acts ? `/${arc.total_acts}` : ""}</p>
                  {arc.historical_accuracy != null && (
                    <p className="text-[10px] text-gray-600 mt-0.5">{Math.round(arc.historical_accuracy * 100)}% complete historically</p>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {progress !== null && (
                <div className="mb-4">
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00C2FF] rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              {/* What this pattern means */}
              {patternInfo && (
                <div className="bg-[#050505] border border-white/5 rounded-xl p-3 mb-4 space-y-2">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">What Jeff detected</p>
                  <p className="text-xs text-gray-300 leading-relaxed">{patternInfo.what}</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed italic">{patternInfo.example}</p>
                </div>
              )}

              {/* Act timeline */}
              <div className="relative pl-5 space-y-4">
                <div className="absolute left-1.5 top-0 bottom-0 w-px bg-white/8" />

                {(arc.act_descriptions || []).map((act, i) => {
                  const isCurrent = act.act === arc.current_act;
                  const isPast = act.act < arc.current_act;
                  return (
                    <div key={i} className="relative">
                      <div className={`absolute -left-4 top-1 w-2.5 h-2.5 rounded-full border-2 ${
                        isPast ? "bg-[#00FF41] border-[#00FF41]" :
                        isCurrent ? "bg-[#00C2FF] border-[#00C2FF] animate-pulse" :
                        "bg-transparent border-white/15"
                      }`} />
                      <div>
                        <p className={`text-xs font-bold ${
                          isCurrent ? "text-[#00C2FF]" : isPast ? "text-gray-300" : "text-gray-600"
                        }`}>
                          {isCurrent && <span className="text-[10px] mr-1">▶ NOW: </span>}
                          {isPast && <span className="text-[10px] mr-1">✓ </span>}
                          Act {act.act}: {act.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{act.description}</p>
                        {act.started_at && (
                          <p className="text-[10px] text-gray-600 mt-0.5">{new Date(act.started_at).toLocaleDateString()}</p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Predicted next act */}
                {arc.next_act_predicted && arc.current_act < (arc.total_acts || 999) && (
                  <div className="relative opacity-60">
                    <div className="absolute -left-4 top-1 w-2.5 h-2.5 rounded-full border border-dashed border-white/20" />
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Predicted next: {arc.next_act_predicted}</p>
                      {arc.next_act_median_hours && (
                        <p className="text-[10px] text-gray-600 mt-0.5">
                          Historically happens within {formatDuration(arc.next_act_median_hours)} of the current act
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

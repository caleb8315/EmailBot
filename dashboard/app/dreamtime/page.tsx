"use client";

import { useEffect, useState } from "react";

interface DreamtimeScenario {
  id: string;
  generated_date: string;
  scenario_type: string;
  title: string;
  narrative: string;
  probability?: number;
  market_implied_probability?: number;
  jeff_probability?: number;
  signal_chain?: { signal?: string; description?: string }[];
  impact_level: string;
  user_read: boolean;
  user_reaction?: string;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; bgColor: string; headline: string; explanation: string }> = {
  wildcard: {
    label: "Wildcard",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/20",
    headline: "Low odds, massive impact",
    explanation: "Nobody is seriously talking about this — but Jeff thinks it deserves attention. If it happens, it changes everything. Think of it as the scenario most analysts are sleeping on.",
  },
  underrated: {
    label: "Underrated",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10 border-yellow-500/20",
    headline: "More likely than people think",
    explanation: "The mainstream view underestimates this. Jeff's signals suggest a higher probability than what markets or analysts are pricing in. This is where the consensus is most likely wrong.",
  },
  fading_consensus: {
    label: "Fading Consensus",
    color: "text-[#00C2FF]",
    bgColor: "bg-[#00C2FF]/10 border-[#00C2FF]/20",
    headline: "The expected thing won't happen",
    explanation: "Everyone thinks they know how this plays out — but Jeff sees signals that the conventional wisdom is breaking down. The 'obvious' outcome is less certain than it looks.",
  },
};

const IMPACT_CONFIG: Record<string, { label: string; color: string }> = {
  extreme: { label: "Extreme impact", color: "text-red-400" },
  high: { label: "High impact", color: "text-orange-400" },
  medium: { label: "Medium impact", color: "text-yellow-400" },
  low: { label: "Low impact", color: "text-gray-400" },
};

export default function DreamtimePage() {
  const [scenarios, setScenarios] = useState<DreamtimeScenario[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/intel/dreamtime")
      .then(r => r.ok ? r.json() : { scenarios: [] })
      .then(d => setScenarios(d.scenarios || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="text-[#00FF41] font-mono animate-pulse text-sm">Loading overnight analysis...</div>
      </div>
    );
  }

  // Group by date
  const byDate = new Map<string, DreamtimeScenario[]>();
  for (const s of scenarios) {
    const date = s.generated_date;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(s);
  }

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-2">
        <h1 className="text-xl font-bold text-gray-100">What You Missed Overnight</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every night Jeff reviews all the data and asks: what is everyone missing? These are the scenarios worth thinking about.
        </p>
      </div>

      {scenarios.length === 0 ? (
        <div className="text-center py-16 px-4">
          <p className="text-gray-500 text-sm">No overnight scenarios yet.</p>
          <p className="text-gray-600 text-xs mt-2">They generate nightly. Check back in the morning.</p>
        </div>
      ) : (
        <div className="space-y-10 pb-4">
          {[...byDate.entries()].map(([date, dayScenarios]) => (
            <div key={date}>
              <div className="max-w-2xl mx-auto px-4 mb-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  {new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                    weekday: "long", month: "long", day: "numeric",
                  })}
                </p>
              </div>

              <div className="max-w-2xl mx-auto px-4 space-y-4">
                {dayScenarios.map(scenario => {
                  const config = TYPE_CONFIG[scenario.scenario_type] || TYPE_CONFIG.wildcard;
                  const impact = IMPACT_CONFIG[scenario.impact_level?.toLowerCase()] || { label: scenario.impact_level, color: "text-gray-400" };
                  const pct = scenario.probability ? Math.round(scenario.probability * 100) : null;
                  const mktPct = scenario.market_implied_probability
                    ? Math.round(scenario.market_implied_probability * 100)
                    : null;
                  const gap = pct !== null && mktPct !== null ? pct - mktPct : null;

                  return (
                    <div key={scenario.id} className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4">
                      {/* Type badge + new indicator */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${config.bgColor} ${config.color}`}>
                          {config.label}
                        </span>
                        <span className={`text-[11px] font-medium ${impact.color}`}>{impact.label}</span>
                        {!scenario.user_read && (
                          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-[#00FF41]/10 text-[#00FF41] font-bold">NEW</span>
                        )}
                      </div>

                      {/* What kind of scenario this is */}
                      <p className="text-[11px] text-gray-500 leading-snug mb-2">{config.explanation}</p>

                      {/* Title */}
                      <h3 className="text-base font-bold text-gray-100 mb-3 leading-snug">{scenario.title}</h3>

                      {/* Probability comparison */}
                      {pct !== null && (
                        <div className="bg-[#050505] border border-white/5 rounded-xl p-3 mb-3">
                          <div className="flex items-center gap-4 text-sm">
                            <div>
                              <p className="text-[10px] text-gray-500 mb-0.5">Jeff thinks</p>
                              <p className="text-lg font-bold text-[#00FF41]">{pct}%</p>
                            </div>
                            {mktPct !== null && (
                              <>
                                <div className="text-gray-700 text-lg">vs</div>
                                <div>
                                  <p className="text-[10px] text-gray-500 mb-0.5">Consensus says</p>
                                  <p className="text-lg font-bold text-gray-400">{mktPct}%</p>
                                </div>
                                {gap !== null && (
                                  <div className="ml-auto text-right">
                                    <p className="text-[10px] text-gray-500 mb-0.5">Jeff&apos;s edge</p>
                                    <p className={`text-sm font-bold ${gap > 0 ? "text-yellow-400" : "text-gray-600"}`}>
                                      {gap > 0 ? `+${gap}%` : `${gap}%`}
                                    </p>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Narrative */}
                      <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{scenario.narrative}</p>

                      {/* Signal chain */}
                      {scenario.signal_chain && scenario.signal_chain.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-white/5">
                          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-2">What signals led here</p>
                          <div className="space-y-2">
                            {(scenario.signal_chain as Array<string | { signal?: string; description?: string }>).map((signal, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <span className="text-[10px] text-gray-600 font-mono mt-0.5 shrink-0">{i + 1}.</span>
                                <p className="text-xs text-gray-500 leading-relaxed">
                                  {typeof signal === "string" ? signal : signal.description || signal.signal || JSON.stringify(signal)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

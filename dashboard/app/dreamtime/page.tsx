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

const TYPE_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  wildcard: {
    label: "WILDCARD",
    color: "text-red-400",
    description: "Low probability, extreme impact. Nobody is discussing this.",
  },
  underrated: {
    label: "UNDERRATED",
    color: "text-yellow-400",
    description: "Higher probability than consensus believes. Everyone is wrong about this.",
  },
  fading_consensus: {
    label: "FADING CONSENSUS",
    color: "text-[#00C2FF]",
    description: "The expected outcome won't happen. Here's why.",
  },
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
        <div className="text-[#00FF41] font-mono animate-pulse">LOADING DREAMTIME SCENARIOS...</div>
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
    <div className="min-h-screen bg-[#050505] text-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-[#00FF41] font-mono tracking-tight">
            DREAMTIME ENGINE
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-mono">
            Jeff thinks while you sleep. Generated at 3am every night.
          </p>
        </header>

        {scenarios.length === 0 ? (
          <p className="text-sm text-gray-600 py-12 text-center">
            No Dreamtime scenarios yet. They generate overnight at 3am.
          </p>
        ) : (
          <div className="space-y-10">
            {[...byDate.entries()].map(([date, dayScenarios]) => (
              <div key={date}>
                <h2 className="text-sm font-bold text-gray-400 font-mono mb-4">
                  {new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </h2>
                <div className="space-y-4">
                  {dayScenarios.map(scenario => {
                    const config = TYPE_CONFIG[scenario.scenario_type] || TYPE_CONFIG.wildcard;
                    const pct = scenario.probability ? Math.round(scenario.probability * 100) : null;
                    const mktPct = scenario.market_implied_probability
                      ? Math.round(scenario.market_implied_probability * 100)
                      : null;

                    return (
                      <div key={scenario.id} className="border border-white/10 rounded-lg p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`text-[10px] font-bold font-mono ${config.color}`}>
                            {config.label}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            scenario.impact_level === "extreme"
                              ? "bg-red-500/10 text-red-400"
                              : scenario.impact_level === "high"
                              ? "bg-yellow-500/10 text-yellow-400"
                              : "bg-white/5 text-gray-500"
                          }`}>
                            {scenario.impact_level?.toUpperCase()} IMPACT
                          </span>
                          {!scenario.user_read && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00FF41]/10 text-[#00FF41]">NEW</span>
                          )}
                        </div>

                        <h3 className="text-base font-bold text-gray-200 mb-2">{scenario.title}</h3>

                        {pct !== null && (
                          <div className="flex items-center gap-4 mb-3 text-xs">
                            <span className="font-mono">
                              Jeff: <span className="text-[#00FF41]">{pct}%</span>
                            </span>
                            {mktPct !== null && (
                              <span className="font-mono">
                                Consensus: <span className="text-gray-500">{mktPct}%</span>
                              </span>
                            )}
                            {pct !== null && mktPct !== null && (
                              <span className={`font-mono text-[10px] ${
                                pct > mktPct ? "text-yellow-400" : "text-gray-600"
                              }`}>
                                {pct > mktPct ? `+${pct - mktPct}% vs consensus` : `${pct - mktPct}% vs consensus`}
                              </span>
                            )}
                          </div>
                        )}

                        <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line mb-3">
                          {scenario.narrative}
                        </p>

                        {scenario.signal_chain && scenario.signal_chain.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-white/5">
                            <p className="text-[10px] text-gray-500 font-mono mb-2">SIGNAL CHAIN</p>
                            <div className="space-y-1">
                              {(scenario.signal_chain as Array<string | { signal?: string; description?: string }>).map((signal, i) => (
                                <p key={i} className="text-[10px] text-gray-500">
                                  {i + 1}. {typeof signal === 'string' ? signal : signal.description || signal.signal || JSON.stringify(signal)}
                                </p>
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
    </div>
  );
}

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
        <div className="text-[#00FF41] font-mono animate-pulse">LOADING NARRATIVE ARCS...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-[#00FF41] font-mono tracking-tight">
            NARRATIVE ARC TRACKER
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-mono">
            Events are chapters. Jeff tracks the story.
          </p>
        </header>

        {arcs.length === 0 ? (
          <p className="text-sm text-gray-600 py-12 text-center">
            No active narrative arcs. They form when pattern sequences match historical templates.
          </p>
        ) : (
          <div className="space-y-6">
            {arcs.map(arc => (
              <div key={arc.id} className="border border-white/10 rounded-lg p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-gray-200">{arc.title}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      {arc.region && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{arc.region}</span>
                      )}
                      {arc.historical_accuracy && (
                        <span className="text-[10px] text-gray-600">
                          Pattern completes {Math.round(arc.historical_accuracy * 100)}% historically
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-mono px-2 py-1 rounded ${
                    arc.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-500'
                  }`}>
                    Act {arc.current_act}/{arc.total_acts || '?'}
                  </span>
                </div>

                {/* Act timeline */}
                <div className="relative pl-6 space-y-4">
                  <div className="absolute left-2 top-0 bottom-0 w-px bg-white/10" />

                  {(arc.act_descriptions || []).map((act, i) => {
                    const isCurrent = act.act === arc.current_act;
                    const isPast = act.act < arc.current_act;

                    return (
                      <div key={i} className="relative">
                        <div className={`absolute -left-4 top-1 w-3 h-3 rounded-full border-2 ${
                          isPast ? 'bg-[#00FF41] border-[#00FF41]' :
                          isCurrent ? 'bg-[#00C2FF] border-[#00C2FF] animate-pulse' :
                          'bg-transparent border-white/20'
                        }`} />
                        <div>
                          <p className={`text-xs font-bold ${
                            isCurrent ? 'text-[#00C2FF]' : isPast ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                            Act {act.act}: {act.title}
                          </p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{act.description}</p>
                          {act.started_at && (
                            <p className="text-[10px] text-gray-600 mt-0.5">
                              {new Date(act.started_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Future acts (predicted) */}
                  {arc.next_act_predicted && arc.current_act < (arc.total_acts || 999) && (
                    <div className="relative opacity-50">
                      <div className="absolute -left-4 top-1 w-3 h-3 rounded-full border-2 border-dashed border-white/20" />
                      <p className="text-xs text-gray-600">
                        Next: {arc.next_act_predicted}
                        {arc.next_act_median_hours && (
                          <span className="ml-2 text-[10px]">
                            (~{arc.next_act_median_hours < 24
                              ? `${Math.round(arc.next_act_median_hours)}hrs`
                              : `${Math.round(arc.next_act_median_hours / 24)}d`
                            } historically)
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

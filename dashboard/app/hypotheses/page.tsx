"use client";

import { useEffect, useState } from "react";

interface Hypothesis {
  id: string;
  title: string;
  confidence: number;
  prior_confidence: number;
  confidence_history: { timestamp: string; confidence: number; reason: string }[];
  competing_hypothesis_ids: string[];
  supporting_signals: string[];
  undermining_signals: string[];
  status: string;
  region?: string;
  tags: string[];
  last_updated: string;
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
        <div className="text-[#00FF41] font-mono animate-pulse">LOADING HYPOTHESIS BOARD...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-[#00FF41] font-mono tracking-tight">
            BAYESIAN HYPOTHESIS BOARD
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-mono">
            {hypotheses.length} active competing explanations
          </p>
        </header>

        {hypotheses.length === 0 ? (
          <p className="text-sm text-gray-600 py-12 text-center">
            No active hypotheses. They form automatically when pattern matches fire.
          </p>
        ) : (
          <div className="space-y-4">
            {hypotheses.map(h => {
              const pct = Math.round(h.confidence * 100);
              const delta = h.confidence - h.prior_confidence;
              const deltaStr = delta > 0 ? `+${(delta * 100).toFixed(1)}%` : `${(delta * 100).toFixed(1)}%`;
              const isOpen = expanded === h.id;

              return (
                <div
                  key={h.id}
                  className="border border-white/10 rounded-lg overflow-hidden hover:border-[#00FF41]/30 transition-colors"
                >
                  <button
                    className="w-full p-4 text-left"
                    onClick={() => setExpanded(isOpen ? null : h.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-mono text-sm font-bold"
                        style={{
                          background: `conic-gradient(${pct >= 60 ? '#00FF41' : pct >= 30 ? '#EAB308' : '#EF4444'} ${pct * 3.6}deg, rgba(255,255,255,0.05) 0deg)`,
                        }}
                      >
                        {pct}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-200 truncate">{h.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-mono ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {deltaStr}
                          </span>
                          {h.region && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{h.region}</span>
                          )}
                          <span className="text-[10px] text-gray-600">
                            {h.supporting_signals?.length || 0} supporting / {h.undermining_signals?.length || 0} undermining
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
                      {/* Confidence timeline */}
                      <div>
                        <p className="text-[10px] text-gray-400 font-mono mb-2">CONFIDENCE HISTORY</p>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {(h.confidence_history || []).slice(-10).map((entry, i) => (
                            <div key={i} className="flex items-center gap-2 text-[10px]">
                              <span className="text-gray-600 w-28 shrink-0">
                                {new Date(entry.timestamp).toLocaleDateString()}
                              </span>
                              <span className="text-[#00FF41] font-mono w-10 shrink-0">
                                {Math.round(entry.confidence * 100)}%
                              </span>
                              <span className="text-gray-500 truncate">{entry.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {h.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {h.tags.map(t => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

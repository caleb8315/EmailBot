"use client";

import { useEffect, useState, useCallback } from "react";

interface Prediction {
  id: string;
  predictor: string;
  statement: string;
  confidence_at_prediction: number;
  made_at: string;
  resolve_by?: string;
  resolved_at?: string;
  outcome?: string;
  outcome_notes?: string;
  brier_score?: number;
  tags: string[];
  region?: string;
}

interface CalibrationReport {
  overall_brier_score: number;
  by_region: Record<string, number>;
  by_topic: Record<string, number>;
  total_predictions: number;
  correct_predictions: number;
  jeff_vs_user: { jeff_avg: number; user_avg: number };
}

const OUTCOME_OPTIONS = [
  { value: "correct", label: "Correct", color: "text-green-400", bg: "bg-green-500/15 border-green-500/30" },
  { value: "incorrect", label: "Incorrect", color: "text-red-400", bg: "bg-red-500/15 border-red-500/30" },
  { value: "partial", label: "Partial", color: "text-yellow-400", bg: "bg-yellow-500/15 border-yellow-500/30" },
  { value: "unresolvable", label: "Unresolvable", color: "text-gray-400", bg: "bg-white/5 border-white/10" },
] as const;

function ResolveControls({ prediction, onResolved }: { prediction: Prediction; onResolved: () => void }) {
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!selectedOutcome || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/intel/predictions/${prediction.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: selectedOutcome, notes: notes.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || res.statusText);
      }
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isOverdue = prediction.resolve_by && new Date(prediction.resolve_by) < new Date();

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      {isOverdue && (
        <div className="mb-2 text-[10px] text-orange-400 font-mono flex items-center gap-1">
          <span>⚠</span> Past resolve-by date ({new Date(prediction.resolve_by!).toLocaleDateString()})
        </div>
      )}
      <p className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-2">Resolve Outcome</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {OUTCOME_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSelectedOutcome(selectedOutcome === opt.value ? null : opt.value)}
            className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition ${
              selectedOutcome === opt.value
                ? `${opt.bg} ${opt.color}`
                : "border-white/10 text-gray-500 hover:border-white/20"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {selectedOutcome && (
        <>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes (what happened, evidence...)"
            className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00FF41]/30 mb-2 resize-none"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-1.5 rounded-lg bg-[#00FF41]/10 text-[#00FF41] text-xs font-bold disabled:opacity-40 hover:bg-[#00FF41]/20 transition"
            >
              {submitting ? "Resolving..." : `Mark as ${selectedOutcome}`}
            </button>
            <button
              onClick={() => { setSelectedOutcome(null); setNotes(""); }}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        </>
      )}
    </div>
  );
}

export default function PredictionsPage() {
  const [active, setActive] = useState<Prediction[]>([]);
  const [resolved, setResolved] = useState<Prediction[]>([]);
  const [calibration, setCalibration] = useState<CalibrationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "resolved" | "calibration">("active");

  const loadData = useCallback(() => {
    Promise.all([
      fetch("/api/intel/predictions?status=active").then(r => r.ok ? r.json() : { predictions: [] }),
      fetch("/api/intel/predictions?status=resolved").then(r => r.ok ? r.json() : { predictions: [] }),
      fetch("/api/intel/predictions?calibration=true").then(r => r.ok ? r.json() : { calibration: null }),
    ])
      .then(([a, r, c]) => {
        setActive(a.predictions || []);
        setResolved(r.predictions || []);
        setCalibration(c.calibration || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="text-[#00FF41] font-mono animate-pulse">LOADING PREDICTION LEDGER...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-[#00FF41] font-mono tracking-tight">YOUR PREDICTIONS</h1>
          <p className="text-xs text-gray-500 mt-1 font-mono">
            Track what you think will happen &middot; Jeff scores your accuracy over time
          </p>
        </header>

        <div className="flex gap-1 mb-6 border-b border-white/10 pb-px">
          {(["active", "resolved", "calibration"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-mono uppercase transition-colors ${
                tab === t ? "text-[#00FF41] border-b-2 border-[#00FF41]" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t} {t === "active" ? `(${active.length})` : t === "resolved" ? `(${resolved.length})` : ""}
            </button>
          ))}
        </div>

        {tab === "active" && (
          <div className="space-y-3">
            {active.length === 0 ? (
              <p className="text-sm text-gray-600 py-8 text-center">No active predictions. Use /predict in Telegram to log one.</p>
            ) : (
              active.map(p => (
                <div key={p.id} className="border border-white/10 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-gray-200">{p.statement}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-xs font-mono text-[#00FF41]">
                          {Math.round(p.confidence_at_prediction * 100)}%
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 uppercase">
                          {p.predictor}
                        </span>
                        {p.resolve_by && (
                          <span className={`text-[10px] ${
                            new Date(p.resolve_by) < new Date() ? "text-orange-400" : "text-gray-600"
                          }`}>
                            {new Date(p.resolve_by) < new Date() ? "⚠ Overdue" : `Resolves by ${new Date(p.resolve_by).toLocaleDateString()}`}
                          </span>
                        )}
                        {p.tags?.map(t => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <ResolveControls prediction={p} onResolved={loadData} />
                </div>
              ))
            )}
          </div>
        )}

        {tab === "resolved" && (
          <div className="space-y-3">
            {resolved.length === 0 ? (
              <p className="text-sm text-gray-600 py-8 text-center">No resolved predictions yet.</p>
            ) : (
              resolved.map(p => (
                <div key={p.id} className="border border-white/10 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-gray-300">{p.statement}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className={`text-xs font-bold ${
                          p.outcome === "correct" ? "text-green-400" :
                          p.outcome === "partial" ? "text-yellow-400" :
                          p.outcome === "unresolvable" ? "text-gray-400" :
                          "text-red-400"
                        }`}>
                          {p.outcome?.toUpperCase()}
                        </span>
                        <span className="text-xs font-mono text-gray-500">
                          Called {Math.round(p.confidence_at_prediction * 100)}%
                        </span>
                        {p.brier_score !== undefined && p.brier_score !== null && (
                          <span className="text-[10px] font-mono text-gray-600">Brier: {p.brier_score.toFixed(3)}</span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 uppercase">
                          {p.predictor}
                        </span>
                      </div>
                      {p.outcome_notes && (
                        <p className="text-[11px] text-gray-500 mt-2 italic">{p.outcome_notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "calibration" && (
          <div className="space-y-6">
            {!calibration ? (
              <p className="text-sm text-gray-600 py-8 text-center">Need resolved predictions for calibration data.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="border border-white/10 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold font-mono text-[#00FF41]">
                      {calibration.overall_brier_score.toFixed(3)}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-1">OVERALL BRIER</p>
                  </div>
                  <div className="border border-white/10 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold font-mono text-[#00C2FF]">{calibration.total_predictions}</p>
                    <p className="text-[10px] text-gray-500 mt-1">TOTAL PREDICTIONS</p>
                  </div>
                  <div className="border border-white/10 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold font-mono text-green-400">{calibration.correct_predictions}</p>
                    <p className="text-[10px] text-gray-500 mt-1">CORRECT</p>
                  </div>
                  <div className="border border-white/10 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold font-mono">
                      <span className="text-[#00C2FF]">{calibration.jeff_vs_user.jeff_avg.toFixed(3)}</span>
                      <span className="text-gray-600 mx-1">vs</span>
                      <span className="text-yellow-400">{calibration.jeff_vs_user.user_avg.toFixed(3)}</span>
                    </p>
                    <p className="text-[10px] text-gray-500 mt-1">JEFF vs YOU (Brier)</p>
                  </div>
                </div>

                {Object.keys(calibration.by_region).length > 0 && (
                  <div className="border border-white/10 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-gray-400 font-mono mb-3">BY REGION</h3>
                    <div className="space-y-2">
                      {Object.entries(calibration.by_region).map(([region, score]) => (
                        <div key={region} className="flex items-center gap-3">
                          <span className="text-xs text-gray-300 w-24">{region}</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-2 bg-[#00FF41] rounded-full"
                              style={{ width: `${score * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-gray-500">{(score * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(calibration.by_topic).length > 0 && (
                  <div className="border border-white/10 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-gray-400 font-mono mb-3">BY TOPIC</h3>
                    <div className="space-y-2">
                      {Object.entries(calibration.by_topic).map(([topic, score]) => (
                        <div key={topic} className="flex items-center gap-3">
                          <span className="text-xs text-gray-300 w-24">{topic}</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-2 bg-[#00C2FF] rounded-full"
                              style={{ width: `${score * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-gray-500">{(score * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

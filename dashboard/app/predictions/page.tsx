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
  { value: "correct", label: "Correct ✓", color: "text-green-400", bg: "bg-green-500/15 border-green-500/30" },
  { value: "incorrect", label: "Incorrect ✗", color: "text-red-400", bg: "bg-red-500/15 border-red-500/30" },
  { value: "partial", label: "Partial", color: "text-yellow-400", bg: "bg-yellow-500/15 border-yellow-500/30" },
  { value: "unresolvable", label: "Can't tell", color: "text-gray-400", bg: "bg-white/5 border-white/10" },
] as const;

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(ms / 3600000);
  if (hrs > 0) return `${hrs}h ago`;
  return "just now";
}

/** Strip internal system tags and make them human-readable */
function humanizeTag(tag: string): string | null {
  // Drop internal prefixes and machine-generated tags
  if (tag.startsWith("intel_dedupe:")) return null;
  if (tag.startsWith("source:")) return null;
  if (tag === "pattern_match") return null;
  if (tag === "source:pattern_match") return null;
  if (tag.startsWith("pattern:")) return tag.replace("pattern:", "").replace(/_/g, " ");
  // Clean up underscores
  return tag.replace(/_/g, " ");
}

/** Best-effort humanize of machine-generated prediction statements */
function humanizeStatement(statement: string): string {
  // Pattern: "Within Xh, follow-on events will corroborate pattern "foo_bar" in Region (operational significance)."
  const m = statement.match(/Within\s+(\d+)h,\s+follow-on events will corroborate pattern\s+"([^"]+)"\s+in\s+([^(]+)\(([^)]+)\)/i);
  if (m) {
    const hours = parseInt(m[1]);
    const pattern = m[2].replace(/_/g, " ");
    const region = m[3].trim();
    const days = Math.round(hours / 24);
    const timeframe = days >= 7 ? `${Math.round(days / 7)} week${Math.round(days / 7) !== 1 ? "s" : ""}` : `${days} day${days !== 1 ? "s" : ""}`;
    const regionStr = region === "Global" ? "globally" : `in ${region}`;
    return `Jeff predicts: the ${pattern} signal will be confirmed by follow-on events ${regionStr} within ${timeframe}.`;
  }
  return statement;
}

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
    <div className="mt-4 border-t border-white/5 pt-4">
      {isOverdue && (
        <div className="mb-3 text-xs text-orange-400 flex items-center gap-1.5">
          <span>⚠</span>
          <span>Past resolve-by date — what actually happened?</span>
        </div>
      )}
      <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-3 font-semibold">How did this turn out?</p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {OUTCOME_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSelectedOutcome(selectedOutcome === opt.value ? null : opt.value)}
            className={`text-sm font-semibold py-2.5 px-3 rounded-xl border transition-all ${
              selectedOutcome === opt.value
                ? `${opt.bg} ${opt.color}`
                : "border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {selectedOutcome && (
        <div className="space-y-3">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What happened? (optional)"
            className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00FF41]/30 resize-none"
            rows={2}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-[#00FF41]/10 text-[#00FF41] text-sm font-bold disabled:opacity-40 hover:bg-[#00FF41]/20 transition"
            >
              {submitting ? "Saving..." : "Save outcome"}
            </button>
            <button
              onClick={() => { setSelectedOutcome(null); setNotes(""); }}
              className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-300 transition"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
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
        <div className="text-[#00FF41] font-mono animate-pulse text-sm">Loading predictions...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <h1 className="text-xl font-bold text-gray-100 tracking-tight">Predictions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Jeff tracks what you and he think will happen — and scores the accuracy over time.
        </p>
      </div>

      {/* Tabs */}
      <div className="sticky top-11 z-40 bg-[#050505]/95 backdrop-blur-md border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 flex gap-0">
          {(["active", "resolved", "calibration"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${
                tab === t
                  ? "text-[#00FF41] border-[#00FF41]"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              }`}
            >
              {t === "active" ? `Active${active.length > 0 ? ` (${active.length})` : ""}` :
               t === "resolved" ? `Resolved${resolved.length > 0 ? ` (${resolved.length})` : ""}` :
               "Accuracy"}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">

        {/* ── Active ── */}
        {tab === "active" && (
          <>
            {active.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-sm">No active predictions yet.</p>
                <p className="text-gray-600 text-xs mt-2">Use <span className="font-mono text-gray-500">/predict</span> in Telegram to log one.</p>
              </div>
            ) : active.map(p => {
              const visibleTags = (p.tags ?? []).map(humanizeTag).filter(Boolean) as string[];
              const overdue = p.resolve_by && new Date(p.resolve_by) < new Date();
              return (
                <div key={p.id} className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4">
                  {/* Statement */}
                  <p className="text-sm text-gray-100 leading-relaxed">{humanizeStatement(p.statement)}</p>

                  {/* Meta row */}
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-base font-bold text-[#00FF41]">
                      {Math.round(p.confidence_at_prediction * 100)}%
                    </span>
                    <span className="text-xs text-gray-600">confidence</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500 uppercase font-bold ml-1">
                      {p.predictor === "jeff" ? "Jeff" : "You"}
                    </span>
                    <span className="text-xs text-gray-600 ml-auto">{timeAgo(p.made_at)}</span>
                  </div>

                  {/* Deadline */}
                  {p.resolve_by && (
                    <div className={`mt-2 text-xs flex items-center gap-1 ${overdue ? "text-orange-400" : "text-gray-500"}`}>
                      {overdue ? "⚠ Overdue · " : "Resolves by "}
                      {formatDate(p.resolve_by)}
                    </div>
                  )}

                  {/* Tags */}
                  {visibleTags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {visibleTags.map(tag => (
                        <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500 capitalize">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Resolve */}
                  <ResolveControls prediction={p} onResolved={loadData} />
                </div>
              );
            })}
          </>
        )}

        {/* ── Resolved ── */}
        {tab === "resolved" && (
          <>
            {resolved.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-sm">No resolved predictions yet.</p>
              </div>
            ) : resolved.map(p => {
              const outcomeColor =
                p.outcome === "correct" ? "text-green-400 bg-green-500/10 border-green-500/20" :
                p.outcome === "incorrect" ? "text-red-400 bg-red-500/10 border-red-500/20" :
                p.outcome === "partial" ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" :
                "text-gray-400 bg-white/5 border-white/10";
              const outcomeLabel =
                p.outcome === "correct" ? "Correct" :
                p.outcome === "incorrect" ? "Incorrect" :
                p.outcome === "partial" ? "Partially correct" :
                p.outcome === "unresolvable" ? "Couldn't determine" :
                p.outcome ?? "—";
              return (
                <div key={p.id} className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4">
                  <p className="text-sm text-gray-300 leading-relaxed">{humanizeStatement(p.statement)}</p>

                  <div className="mt-3 flex items-start gap-2 flex-wrap">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${outcomeColor}`}>
                      {outcomeLabel}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                      <span>Called at {Math.round(p.confidence_at_prediction * 100)}%</span>
                      {p.brier_score != null && (
                        <span className="text-gray-600">· Score: {p.brier_score.toFixed(2)}</span>
                      )}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500 uppercase font-bold">
                        {p.predictor === "jeff" ? "Jeff" : "You"}
                      </span>
                    </div>
                  </div>

                  {p.outcome_notes && (
                    <p className="text-xs text-gray-500 mt-3 leading-relaxed border-t border-white/5 pt-3">{p.outcome_notes}</p>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* ── Calibration ── */}
        {tab === "calibration" && (
          <>
            {!calibration ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-sm">Resolve some predictions to see accuracy data.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Score cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4 text-center">
                    <p className="text-3xl font-bold text-[#00FF41]">
                      {Math.round((1 - calibration.overall_brier_score) * 100)}%
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1">Overall accuracy</p>
                  </div>
                  <div className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4 text-center">
                    <p className="text-3xl font-bold text-[#00C2FF]">{calibration.total_predictions}</p>
                    <p className="text-[11px] text-gray-500 mt-1">Total predictions</p>
                  </div>
                  <div className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4 text-center">
                    <p className="text-3xl font-bold text-green-400">{calibration.correct_predictions}</p>
                    <p className="text-[11px] text-gray-500 mt-1">Correct</p>
                  </div>
                  <div className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4 text-center">
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-xl font-bold text-[#00C2FF]">{Math.round((1 - calibration.jeff_vs_user.jeff_avg) * 100)}%</span>
                      <span className="text-xs text-gray-600">vs</span>
                      <span className="text-xl font-bold text-yellow-400">{Math.round((1 - calibration.jeff_vs_user.user_avg) * 100)}%</span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">Jeff vs You</p>
                  </div>
                </div>

                {Object.keys(calibration.by_region).length > 0 && (
                  <div className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">By Region</h3>
                    <div className="space-y-3">
                      {Object.entries(calibration.by_region).map(([region, score]) => (
                        <div key={region} className="flex items-center gap-3">
                          <span className="text-sm text-gray-300 w-10 shrink-0">{region}</span>
                          <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-2 bg-[#00FF41] rounded-full" style={{ width: `${score * 100}%` }} />
                          </div>
                          <span className="text-xs font-mono text-gray-500 w-10 text-right">{(score * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(calibration.by_topic).length > 0 && (
                  <div className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">By Topic</h3>
                    <div className="space-y-3">
                      {Object.entries(calibration.by_topic).map(([topic, score]) => (
                        <div key={topic} className="flex items-center gap-3">
                          <span className="text-sm text-gray-300 flex-1 truncate capitalize">{topic.replace(/_/g, " ")}</span>
                          <div className="w-24 h-2 rounded-full bg-white/5 overflow-hidden shrink-0">
                            <div className="h-2 bg-[#00C2FF] rounded-full" style={{ width: `${score * 100}%` }} />
                          </div>
                          <span className="text-xs font-mono text-gray-500 w-10 text-right shrink-0">{(score * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-gray-600 text-center pb-2">
                  Lower Brier score = better calibration. 0 is perfect, 1 is worst.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

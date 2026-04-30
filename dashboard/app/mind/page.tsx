"use client";

import { useEffect, useState } from "react";

interface Belief {
  id: string;
  statement: string;
  confidence: number;
  status: string;
  tags: string[];
  region?: string;
  entities: string[];
  jeff_stake?: string;
  user_agrees?: boolean | null;
  last_updated: string;
  evidence_for: { description: string }[];
  evidence_against: { description: string }[];
}

interface Prediction {
  id: string;
  predictor: string;
  statement: string;
  confidence_at_prediction: number;
  made_at: string;
  resolve_by?: string;
  resolved_at?: string;
  outcome?: string;
  brier_score?: number;
}

interface MindState {
  beliefs: Belief[];
  predictions: Prediction[];
  profile: {
    calibration_score?: number;
    total_predictions?: number;
  };
}

async function fetchMind(): Promise<MindState> {
  const [beliefsRes, predsRes] = await Promise.all([
    fetch("/api/intel/beliefs?" + new URLSearchParams({ limit: "50" })),
    fetch("/api/intel/predictions?" + new URLSearchParams({ limit: "30" })),
  ]);

  const beliefs = beliefsRes.ok ? (await beliefsRes.json()).beliefs ?? [] : [];
  const preds = predsRes.ok ? (await predsRes.json()) : { predictions: [], profile: {} };

  return {
    beliefs,
    predictions: preds.predictions ?? [],
    profile: preds.profile ?? {},
  };
}

function ConfidenceBar({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  const h = size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className={`w-full ${h} rounded-full bg-white/10 overflow-hidden`}>
      <div className={`${h} ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function humanizePredictionStatement(statement: string): string {
  const m = statement.match(/Within\s+(\d+)h,\s+follow-on events will corroborate pattern\s+"([^"]+)"\s+in\s+([^(]+)\(([^)]+)\)/i);
  if (m) {
    const hours = parseInt(m[1]);
    const pattern = m[2].replace(/_/g, " ");
    const region = m[3].trim();
    const days = Math.round(hours / 24);
    const timeframe = days >= 7 ? `${Math.round(days / 7)} week${Math.round(days / 7) !== 1 ? "s" : ""}` : `${days} day${days !== 1 ? "s" : ""}`;
    const regionStr = region === "Global" ? "globally" : `in ${region}`;
    return `Jeff predicts: the ${pattern} signal will be confirmed ${regionStr} within ${timeframe}.`;
  }
  return statement;
}

function stakeLabel(stake?: string): string {
  if (stake === "HIGH") return "Jeff has high conviction on this";
  if (stake === "MEDIUM") return "Jeff is moderately confident";
  return "Jeff is tracking this tentatively";
}

function BeliefCard({ belief }: { belief: Belief }) {
  const [open, setOpen] = useState(false);
  const pct = Math.round(belief.confidence * 100);
  const stakeColor =
    belief.jeff_stake === "HIGH" ? "text-red-400" : belief.jeff_stake === "MEDIUM" ? "text-yellow-400" : "text-gray-500";
  const barColor = pct >= 70 ? "#00FF41" : pct >= 40 ? "#EAB308" : "#EF4444";

  return (
    <div
      className="bg-[#0c0c0c] border border-white/8 rounded-2xl p-4 cursor-pointer"
      onClick={() => setOpen(!open)}
    >
      <p className="text-sm text-gray-200 leading-relaxed">{belief.statement}</p>

      {/* Confidence bar */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
        </div>
        <span className="text-sm font-bold font-mono shrink-0" style={{ color: barColor }}>{pct}%</span>
      </div>

      {/* Meta */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className={`text-xs ${stakeColor}`}>{stakeLabel(belief.jeff_stake)}</span>
        {belief.user_agrees === false && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold ml-auto">
            You disagree
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
          {/* Evidence */}
          {belief.evidence_for?.length > 0 && (
            <div>
              <p className="text-[11px] text-green-400 font-semibold mb-1.5">Supporting evidence</p>
              <div className="space-y-1">
                {belief.evidence_for.slice(-3).map((e, i) => (
                  <p key={i} className="text-xs text-gray-400 leading-relaxed">✓ {e.description}</p>
                ))}
              </div>
            </div>
          )}
          {belief.evidence_against?.length > 0 && (
            <div>
              <p className="text-[11px] text-red-400 font-semibold mb-1.5">Evidence against</p>
              <div className="space-y-1">
                {belief.evidence_against.slice(-3).map((e, i) => (
                  <p key={i} className="text-xs text-gray-400 leading-relaxed">✗ {e.description}</p>
                ))}
              </div>
            </div>
          )}
          {belief.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {belief.tags.map(t => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500 capitalize">{t.replace(/_/g, " ")}</span>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-600">Updated {new Date(belief.last_updated).toLocaleDateString()}</p>
        </div>
      )}
    </div>
  );
}

export default function MindPage() {
  const [state, setState] = useState<MindState | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "strong" | "contested" | "fading" | "disagreed">("all");

  useEffect(() => {
    fetchMind()
      .then(setState)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="text-[#00FF41] font-mono animate-pulse">JEFF LOADING WORLD MODEL...</div>
      </div>
    );
  }

  const beliefs = state?.beliefs || [];
  const predictions = state?.predictions || [];
  const profile = state?.profile || {};

  const strong = beliefs.filter(b => b.confidence >= 0.7);
  const contested = beliefs.filter(b => b.confidence >= 0.4 && b.confidence < 0.7);
  const fading = beliefs.filter(b => b.confidence < 0.4);
  const disagreed = beliefs.filter(b => b.user_agrees === false);

  const activePreds = predictions.filter(p => !p.resolved_at);
  const recentResolved = predictions.filter(p => p.resolved_at).slice(0, 5);

  const filtered =
    filter === "strong" ? strong :
    filter === "contested" ? contested :
    filter === "fading" ? fading :
    filter === "disagreed" ? disagreed :
    beliefs;

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-bold text-gray-100">What Jeff Thinks</h1>
          <p className="text-sm text-gray-500 mt-1">
            {beliefs.length} views on the world, each one scored by incoming evidence every 15 minutes.
          </p>
        </header>

        {/* Summary filter cards */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          {[
            { label: "Confident (70%+)", count: strong.length, key: "strong" as const, color: "text-green-400", desc: "High confidence" },
            { label: "Mixed (40–70%)", count: contested.length, key: "contested" as const, color: "text-yellow-400", desc: "Evidence is split" },
            { label: "Fading (<40%)", count: fading.length, key: "fading" as const, color: "text-red-400", desc: "Evidence pushing back" },
            { label: "You disagree", count: disagreed.length, key: "disagreed" as const, color: "text-orange-400", desc: "Flagged by you" },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`p-3 rounded-2xl border text-left transition-colors ${
                filter === item.key
                  ? "border-white/20 bg-white/5"
                  : "border-white/8 bg-[#0c0c0c] hover:border-white/15"
              }`}
            >
              <p className={`text-2xl font-bold ${item.color}`}>{item.count}</p>
              <p className="text-xs text-gray-400 mt-0.5 font-medium">{item.label}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">{item.desc}</p>
            </button>
          ))}
        </div>

        {/* Predictions summary */}
        {activePreds.length > 0 && (
          <div className="mb-6 bg-[#0c0c0c] border border-white/8 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-[#00C2FF] mb-3">Open Predictions</h2>
            <div className="space-y-3">
              {activePreds.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-start gap-3">
                  <span className="text-sm font-bold text-[#00FF41] shrink-0 mt-0.5">{Math.round(p.confidence_at_prediction * 100)}%</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 leading-relaxed">{humanizePredictionStatement(p.statement)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-600 capitalize">{p.predictor === "jeff" ? "Jeff" : "You"}</span>
                      {p.resolve_by && (
                        <span className="text-[10px] text-gray-600">· Due {new Date(p.resolve_by).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent resolutions */}
        {recentResolved.length > 0 && (
          <div className="mb-6 bg-[#0c0c0c] border border-white/8 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Recently resolved</h2>
            <div className="space-y-3">
              {recentResolved.map(p => (
                <div key={p.id} className="flex items-start gap-3">
                  <span className={`text-xs font-bold shrink-0 mt-0.5 ${
                    p.outcome === "correct" ? "text-green-400" :
                    p.outcome === "incorrect" ? "text-red-400" :
                    p.outcome === "partial" ? "text-yellow-400" : "text-gray-500"
                  }`}>
                    {p.outcome === "correct" ? "✓" : p.outcome === "incorrect" ? "✗" : "~"}
                  </span>
                  <p className="text-xs text-gray-400 leading-relaxed">{humanizePredictionStatement(p.statement)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Show all button */}
        <button
          onClick={() => setFilter("all")}
          className={`w-full mb-4 py-2.5 rounded-2xl border text-sm font-medium transition-colors ${
            filter === "all"
              ? "border-white/20 bg-white/5 text-gray-200"
              : "border-white/8 bg-[#0c0c0c] text-gray-500 hover:text-gray-300"
          }`}
        >
          Show all {beliefs.length} views
        </button>

        {/* Belief list */}
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-600 py-8 text-center">No beliefs in this category yet.</p>
          ) : (
            filtered.map(b => <BeliefCard key={b.id} belief={b} />)
          )}
        </div>
      </div>
    </div>
  );
}

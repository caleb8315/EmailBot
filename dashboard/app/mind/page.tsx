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

function BeliefCard({ belief }: { belief: Belief }) {
  const [open, setOpen] = useState(false);
  const pct = Math.round(belief.confidence * 100);
  const stakeColor =
    belief.jeff_stake === "HIGH" ? "text-red-400" : belief.jeff_stake === "MEDIUM" ? "text-yellow-400" : "text-gray-400";

  return (
    <div
      className="border border-white/10 rounded-lg p-4 hover:border-[#00FF41]/30 transition-colors cursor-pointer"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-200 leading-snug">{belief.statement}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs font-mono text-[#00FF41]">{pct}%</span>
            <div className="flex-1"><ConfidenceBar value={belief.confidence} size="sm" /></div>
            {belief.user_agrees === false && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
                YOU DISAGREE
              </span>
            )}
            <span className={`text-[10px] ${stakeColor} font-medium`}>{belief.jeff_stake}</span>
          </div>
        </div>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
          {belief.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {belief.tags.map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{t}</span>
              ))}
            </div>
          )}
          {belief.evidence_for?.length > 0 && (
            <div>
              <p className="text-[10px] text-green-400 font-medium mb-1">SUPPORTING ({belief.evidence_for.length})</p>
              {belief.evidence_for.slice(-3).map((e, i) => (
                <p key={i} className="text-[10px] text-gray-500 leading-tight">+ {e.description}</p>
              ))}
            </div>
          )}
          {belief.evidence_against?.length > 0 && (
            <div>
              <p className="text-[10px] text-red-400 font-medium mb-1">COUNTER ({belief.evidence_against.length})</p>
              {belief.evidence_against.slice(-3).map((e, i) => (
                <p key={i} className="text-[10px] text-gray-500 leading-tight">- {e.description}</p>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-600">
            Updated {new Date(belief.last_updated).toLocaleDateString()}
          </p>
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
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-[#00FF41] font-mono tracking-tight">
            JEFF&apos;S WORLD MODEL
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-mono">
            {beliefs.length} active beliefs &middot; {activePreds.length} open predictions
            &middot; Calibration: {profile.calibration_score ? (profile.calibration_score * 100).toFixed(0) + "%" : "N/A"}
          </p>
        </header>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          {[
            { label: "Strong >70%", count: strong.length, key: "strong" as const, color: "text-green-400" },
            { label: "Contested 40-70%", count: contested.length, key: "contested" as const, color: "text-yellow-400" },
            { label: "Fading <40%", count: fading.length, key: "fading" as const, color: "text-red-400" },
            { label: "You Disagree", count: disagreed.length, key: "disagreed" as const, color: "text-red-300" },
            { label: "All Beliefs", count: beliefs.length, key: "all" as const, color: "text-[#00C2FF]" },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`p-3 rounded-lg border transition-colors text-left ${
                filter === item.key
                  ? "border-[#00FF41]/50 bg-[#00FF41]/5"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <p className={`text-xl font-bold font-mono ${item.color}`}>{item.count}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{item.label}</p>
            </button>
          ))}
        </div>

        {/* Predictions summary */}
        {activePreds.length > 0 && (
          <div className="mb-8 border border-white/10 rounded-lg p-4">
            <h2 className="text-sm font-bold text-[#00C2FF] font-mono mb-3">OPEN PREDICTIONS</h2>
            <div className="space-y-2">
              {activePreds.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-300 flex-1 truncate">{p.statement}</p>
                  <span className="text-xs font-mono text-[#00FF41]">{Math.round(p.confidence_at_prediction * 100)}%</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 uppercase">{p.predictor}</span>
                  {p.resolve_by && (
                    <span className="text-[10px] text-gray-600">{new Date(p.resolve_by).toLocaleDateString()}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent resolutions */}
        {recentResolved.length > 0 && (
          <div className="mb-8 border border-white/10 rounded-lg p-4">
            <h2 className="text-sm font-bold text-gray-400 font-mono mb-3">RECENTLY RESOLVED</h2>
            <div className="space-y-2">
              {recentResolved.map(p => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className={`text-xs ${p.outcome === "correct" ? "text-green-400" : "text-red-400"}`}>
                    {p.outcome === "correct" ? "CORRECT" : p.outcome === "incorrect" ? "WRONG" : p.outcome?.toUpperCase()}
                  </span>
                  <p className="text-xs text-gray-400 flex-1 truncate">{p.statement}</p>
                  {p.brier_score !== undefined && p.brier_score !== null && (
                    <span className="text-[10px] font-mono text-gray-600">Brier: {p.brier_score.toFixed(2)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Belief list */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-gray-400 font-mono">
            {filter === "all" ? "ALL BELIEFS" : filter.toUpperCase()}
            <span className="text-gray-600 font-normal ml-2">({filtered.length})</span>
          </h2>
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-600 py-8 text-center">No beliefs yet. Jeff is still learning.</p>
          ) : (
            filtered.map(b => <BeliefCard key={b.id} belief={b} />)
          )}
        </div>
      </div>
    </div>
  );
}

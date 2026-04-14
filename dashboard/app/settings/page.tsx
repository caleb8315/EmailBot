"use client";

import { useCallback, useEffect, useState } from "react";

type BriefingOverlay = { boost_categories: string[]; ignore_categories: string[]; tier1_keywords: string[] };
type Preferences = {
  interests: string[]; dislikes: string[]; alert_sensitivity: number;
  trusted_sources: string[]; blocked_sources: string[]; briefing_overlay: BriefingOverlay;
};

const SECTIONS = [
  "World & Geopolitics", "Wars & Conflicts", "Economy & Markets", "Stocks",
  "Crypto", "AI & Technology", "Power & Elite Activity", "Conspiracy / Unverified Signals",
] as const;

const QUICK_INTERESTS = ["AI", "Macro", "Geopolitics", "Crypto", "Energy", "Defense", "Semiconductors", "Rates"] as const;

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) { const t = v.trim(); const k = t.toLowerCase(); if (!t || seen.has(k)) continue; seen.add(k); result.push(t); }
  return result;
}

function normalizePreferences(raw: any): Preferences {
  return {
    interests: Array.isArray(raw?.interests) ? raw.interests : [],
    dislikes: Array.isArray(raw?.dislikes) ? raw.dislikes : [],
    alert_sensitivity: typeof raw?.alert_sensitivity === "number" ? raw.alert_sensitivity : 5,
    trusted_sources: Array.isArray(raw?.trusted_sources) ? raw.trusted_sources : [],
    blocked_sources: Array.isArray(raw?.blocked_sources) ? raw.blocked_sources : [],
    briefing_overlay: {
      boost_categories: Array.isArray(raw?.briefing_overlay?.boost_categories) ? raw.briefing_overlay.boost_categories : [],
      ignore_categories: Array.isArray(raw?.briefing_overlay?.ignore_categories) ? raw.briefing_overlay.ignore_categories : [],
      tier1_keywords: Array.isArray(raw?.briefing_overlay?.tier1_keywords) ? raw.briefing_overlay.tier1_keywords : [],
    },
  };
}

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [interestInput, setInterestInput] = useState("");
  const [dislikeInput, setDislikeInput] = useState("");
  const [trustedInput, setTrustedInput] = useState("");
  const [blockedInput, setBlockedInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/data/preferences");
      if (!res.ok) return;
      const data = await res.json();
      setPrefs(normalizePreferences(data.preferences));
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const mutate = (fn: (p: Preferences) => Preferences) => {
    setPrefs(prev => prev ? normalizePreferences(fn(prev)) : prev);
    setDirty(true);
  };

  const addItem = (field: "interests" | "dislikes" | "trusted_sources" | "blocked_sources" | "tier1_keywords", raw: string) => {
    const v = raw.trim();
    if (!v) return;
    mutate(p => {
      if (field === "tier1_keywords") return { ...p, briefing_overlay: { ...p.briefing_overlay, tier1_keywords: dedupeStrings([...p.briefing_overlay.tier1_keywords, v]) } };
      return { ...p, [field]: dedupeStrings([...(p[field] as string[]), v]) };
    });
  };

  const removeItem = (field: "interests" | "dislikes" | "trusted_sources" | "blocked_sources" | "tier1_keywords", v: string) => {
    const lower = v.toLowerCase();
    mutate(p => {
      if (field === "tier1_keywords") return { ...p, briefing_overlay: { ...p.briefing_overlay, tier1_keywords: p.briefing_overlay.tier1_keywords.filter(i => i.toLowerCase() !== lower) } };
      return { ...p, [field]: (p[field] as string[]).filter(i => i.toLowerCase() !== lower) };
    });
  };

  const save = async () => {
    if (!prefs || saving) return;
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("/api/data/preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interests: prefs.interests, dislikes: prefs.dislikes, alert_sensitivity: prefs.alert_sensitivity,
          trusted_sources: prefs.trusted_sources, blocked_sources: prefs.blocked_sources,
          briefing_overlay: { boost_categories: prefs.briefing_overlay.boost_categories, ignore_categories: prefs.briefing_overlay.ignore_categories, tier1_keywords: prefs.briefing_overlay.tier1_keywords },
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || res.statusText); }
      const data = await res.json();
      setPrefs(normalizePreferences(data.preferences));
      setDirty(false); setMsg("Saved");
      setTimeout(() => setMsg(null), 2000);
    } catch (err) { setMsg(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };

  const dispatch = async (workflow: string) => {
    setDispatchMsg(null);
    try {
      const res = await fetch("/api/github/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || res.statusText);
      setDispatchMsg(`Triggered ${workflow}`);
    } catch (err) { setDispatchMsg(err instanceof Error ? err.message : String(err)); }
    setTimeout(() => setDispatchMsg(null), 3000);
  };

  if (!prefs) return <div className="min-h-screen bg-[#050505] flex items-center justify-center text-gray-500 text-sm">Loading...</div>;

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-[#00FF41] font-mono">SETTINGS</h1>
          <button onClick={save} disabled={!dirty || saving} className="px-4 py-1.5 rounded-lg bg-[#00FF41]/10 text-[#00FF41] text-xs font-bold disabled:opacity-30 transition">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {msg && <p className="text-xs text-center text-[#00FF41]">{msg}</p>}

        {/* Quick interests */}
        <Section title="Quick Interests" subtitle="Tap to toggle">
          <div className="flex flex-wrap gap-2">
            {QUICK_INTERESTS.map(topic => {
              const active = prefs.interests.some(i => i.toLowerCase() === topic.toLowerCase());
              return (
                <button key={topic} onClick={() => active ? removeItem("interests", topic) : addItem("interests", topic)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${active ? "border-[#00FF41]/45 bg-[#00FF41]/10 text-gray-200" : "border-white/10 bg-[#0c0c0c] text-gray-500 hover:border-[#00FF41]/30"}`}
                >{topic}</button>
              );
            })}
          </div>
        </Section>

        <ChipEditor title="Interests" items={prefs.interests} value={interestInput} onChange={setInterestInput}
          onAdd={() => { addItem("interests", interestInput); setInterestInput(""); }}
          onRemove={v => removeItem("interests", v)} placeholder="Add interest" />

        <ChipEditor title="Dislikes" items={prefs.dislikes} value={dislikeInput} onChange={setDislikeInput}
          onAdd={() => { addItem("dislikes", dislikeInput); setDislikeInput(""); }}
          onRemove={v => removeItem("dislikes", v)} placeholder="Add topic to de-prioritize" />

        {/* Alert sensitivity */}
        <Section title="Alert Sensitivity">
          <input type="range" min={1} max={10} value={prefs.alert_sensitivity}
            onChange={e => mutate(p => ({ ...p, alert_sensitivity: Number(e.target.value) }))}
            className="w-full accent-[#00FF41]" />
          <div className="flex justify-between text-[10px] text-gray-500 mt-1"><span>Strict</span><span>Balanced</span><span>Wide net</span></div>
        </Section>

        {/* Section boost/ignore */}
        <Section title="Section Priority" subtitle="Boost or ignore briefing categories">
          <div className="space-y-1.5">
            {SECTIONS.map(s => {
              const boosted = prefs.briefing_overlay.boost_categories.includes(s);
              const ignored = prefs.briefing_overlay.ignore_categories.includes(s);
              return (
                <div key={s} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 text-gray-300">{s}</span>
                  <button onClick={() => mutate(p => {
                    const b = new Set(p.briefing_overlay.boost_categories); const ig = new Set(p.briefing_overlay.ignore_categories);
                    b.has(s) ? b.delete(s) : (b.add(s), ig.delete(s));
                    return { ...p, briefing_overlay: { ...p.briefing_overlay, boost_categories: [...b], ignore_categories: [...ig] } };
                  })} className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${boosted ? "bg-green-500/15 text-green-400" : "text-gray-600 hover:text-gray-400"}`}>
                    BOOST
                  </button>
                  <button onClick={() => mutate(p => {
                    const b = new Set(p.briefing_overlay.boost_categories); const ig = new Set(p.briefing_overlay.ignore_categories);
                    ig.has(s) ? ig.delete(s) : (ig.add(s), b.delete(s));
                    return { ...p, briefing_overlay: { ...p.briefing_overlay, boost_categories: [...b], ignore_categories: [...ig] } };
                  })} className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${ignored ? "bg-red-500/15 text-red-400" : "text-gray-600 hover:text-gray-400"}`}>
                    MUTE
                  </button>
                </div>
              );
            })}
          </div>
        </Section>

        <ChipEditor title="Tier 1 Keywords" items={prefs.briefing_overlay.tier1_keywords} value={keywordInput} onChange={setKeywordInput}
          onAdd={() => { addItem("tier1_keywords", keywordInput); setKeywordInput(""); }}
          onRemove={v => removeItem("tier1_keywords", v)} placeholder="High-priority keyword" />

        <ChipEditor title="Trusted Sources" items={prefs.trusted_sources} value={trustedInput} onChange={setTrustedInput}
          onAdd={() => { addItem("trusted_sources", trustedInput); setTrustedInput(""); }}
          onRemove={v => removeItem("trusted_sources", v)} placeholder="reuters.com" />

        <ChipEditor title="Blocked Sources" items={prefs.blocked_sources} value={blockedInput} onChange={setBlockedInput}
          onAdd={() => { addItem("blocked_sources", blockedInput); setBlockedInput(""); }}
          onRemove={v => removeItem("blocked_sources", v)} placeholder="example.com" />

        {/* Workflow dispatch */}
        <Section title="Run Workflows">
          <div className="flex flex-wrap gap-2">
            {["pipeline.yml", "daily_email.yml", "weekly_digest.yml", "ingest.yml", "dreamtime.yml"].map(w => (
              <button key={w} onClick={() => dispatch(w)}
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-[#0c0c0c] text-[11px] text-gray-400 hover:border-[#00FF41]/30 hover:text-gray-200 transition">
                {w.replace(".yml", "")}
              </button>
            ))}
          </div>
          {dispatchMsg && <p className="text-xs text-[#00FF41] mt-2">{dispatchMsg}</p>}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0c0c0c] border border-white/5 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      {subtitle && <p className="text-[11px] text-gray-500 mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="h-3" />}
      {children}
    </div>
  );
}

function ChipEditor({ title, items, value, onChange, onAdd, onRemove, placeholder }: {
  title: string; items: string[]; value: string; onChange: (v: string) => void;
  onAdd: () => void; onRemove: (v: string) => void; placeholder: string;
}) {
  return (
    <Section title={title}>
      <div className="flex gap-2">
        <input value={value} onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
          placeholder={placeholder}
          className="flex-1 bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00FF41]/30" />
        <button onClick={onAdd} className="px-3 py-2 rounded-lg border border-white/10 text-xs text-gray-400 hover:text-gray-200 transition">Add</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {items.length === 0 ? <span className="text-[11px] text-gray-600">None</span> : items.map(item => (
          <button key={item} onClick={() => onRemove(item)}
            className="inline-flex items-center gap-1 rounded-full border border-[#00FF41]/20 bg-[#00FF41]/5 px-2.5 py-1 text-xs text-gray-300 hover:bg-[#00FF41]/15 transition" title="Remove">
            {item} <span className="text-gray-500">x</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

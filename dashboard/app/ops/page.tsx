"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

/* ────── Types ────── */

interface MapEvent {
  id: string;
  source: string;
  type: string;
  severity: number;
  title: string;
  summary: string;
  timestamp: string;
  created_at?: string;
  expires_at?: string | null;
  country_code: string;
  tags: string[];
  lat?: number | null;
  lng?: number | null;
}

interface FusedSignal {
  id: string;
  headline: string;
  summary: string;
  category: string;
  severity: number;
  confidence: number;
  alert_tier: string;
  source_engines: string[];
  corroboration: {
    engine_count: number;
    source_diversity: number;
    has_structured_event: boolean;
    has_news_article: boolean;
  };
  tags: string[];
  country_code?: string;
  created_at: string;
}

interface Article {
  url: string;
  title: string;
  source: string;
  summary: string | null;
  importance_score: number | null;
  fetched_at: string;
}

interface EngineRun {
  id: string;
  engine: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_in: number;
  records_out: number;
  ai_calls_used: number;
}

interface Hypothesis {
  id: string;
  title: string;
  status: string;
  evidence_score: number;
}

interface NarrativeArc {
  id: string;
  title: string;
  current_act: string;
  significance: number;
}

interface DreamScenario {
  id: string;
  title: string;
  scenario_type: string;
  probability: number;
  impact_level: string;
}

interface Digest {
  id: string;
  created_at: string;
  channels: string[];
  subject: string | null;
  plain_text: string;
}

interface GHRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

/* ────── Helpers ────── */

type Category = "military" | "conflict" | "fire" | "quake" | "internet" | "other";

function categorize(e: MapEvent): Category {
  if (e.source === "adsb") return "military";
  if (["airstrike", "conflict", "protest"].includes(e.type)) return "conflict";
  if (e.source === "firms" || e.type === "fire") return "fire";
  if (e.type === "earthquake") return "quake";
  if (e.source === "ooni" || e.type?.includes("internet")) return "internet";
  return "other";
}

const CAT_COLORS: Record<Category, string> = {
  military: "#FF3333",
  conflict: "#FF8800",
  fire: "#FF5500",
  quake: "#00BBFF",
  internet: "#AA44FF",
  other: "#00FF41",
};

const CAT_EMOJI: Record<Category, string> = {
  military: "✈",
  conflict: "💥",
  fire: "🔥",
  quake: "🌊",
  internet: "📡",
  other: "📍",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function eventAgeHours(evt: MapEvent): number {
  const ref = evt.created_at || evt.timestamp;
  return (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60);
}

function eventOpacity(evt: MapEvent): number {
  const ageH = eventAgeHours(evt);
  if (ageH < 1) return 1.0;
  if (ageH < 6) return 0.9;
  if (ageH < 12) return 0.7;
  if (ageH < 24) return 0.5;
  return 0.3;
}

function tierColor(tier: string): string {
  switch (tier) {
    case "FLASH": return "#FF3333";
    case "PRIORITY": return "#FF8800";
    case "DAILY": return "#00FF41";
    default: return "#6e7681";
  }
}

function severityBadge(s: number): { label: string; cls: string } {
  if (s >= 80) return { label: "CRITICAL", cls: "bg-red-500/20 text-red-400" };
  if (s >= 60) return { label: "HIGH", cls: "bg-orange-500/20 text-orange-400" };
  if (s >= 40) return { label: "MEDIUM", cls: "bg-yellow-500/20 text-yellow-400" };
  return { label: "LOW", cls: "bg-green-500/20 text-green-400" };
}

/* ────── Main Component ────── */

function OpsCenter() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const [events, setEvents] = useState<MapEvent[]>([]);
  const [fusedSignals, setFusedSignals] = useState<FusedSignal[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [engineRuns, setEngineRuns] = useState<EngineRun[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [arcs, setArcs] = useState<NarrativeArc[]>([]);
  const [dreams, setDreams] = useState<DreamScenario[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<MapEvent | null>(null);

  const [digests, setDigests] = useState<Digest[]>([]);
  const [ghRuns, setGhRuns] = useState<GHRun[]>([]);
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);
  const [digestExpanded, setDigestExpanded] = useState(false);

  const [feedTab, setFeedTab] = useState<"fused" | "articles" | "events">("fused");
  const [showActions, setShowActions] = useState(false);

  /* ── Data fetching ── */
  const safeFetch = async (url: string) => {
    try { const r = await fetch(url); if (!r.ok) return {}; return await r.json(); } catch { return {}; }
  };

  const fetchAll = useCallback(async () => {
    const [ev, fused, art, runs, hypo, arc, dream, dig, ghr] = await Promise.all([
      safeFetch("/api/intel/events?hours=48&limit=500&severity_min=15"),
      safeFetch("/api/intel/fused?hours=48&limit=50"),
      safeFetch("/api/data/articles?limit=30"),
      safeFetch("/api/intel/engine-runs"),
      safeFetch("/api/intel/hypotheses"),
      safeFetch("/api/intel/arcs"),
      safeFetch("/api/intel/dreamtime"),
      safeFetch("/api/data/digests"),
      safeFetch("/api/github/runs"),
    ]);

    setEvents(ev.events ?? []);
    setFusedSignals(fused.signals ?? []);
    setArticles(art.articles ?? []);
    setEngineRuns(runs.runs ?? []);
    setHypotheses(hypo.hypotheses ?? []);
    setArcs(arc.arcs ?? []);
    setDreams(dream.scenarios ?? []);
    setDigests(dig.digests ?? []);
    setGhRuns(ghr.runs ?? []);
  }, []);

  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 60_000); return () => clearInterval(i); }, [fetchAll]);

  /* ── Map initialization ── */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (!document.querySelector("#maplibre-css")) {
        const link = document.createElement("link");
        link.id = "maplibre-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css";
        document.head.appendChild(link);
        await new Promise(r => setTimeout(r, 200));
      }
      if (cancelled || !mapContainer.current) return;
      const m = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8 as const,
          sources: {
            carto: {
              type: "raster",
              tiles: [
                "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
                "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              ],
              tileSize: 256,
              maxzoom: 19,
            },
          },
          layers: [{ id: "carto", type: "raster", source: "carto" }],
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        },
        center: [20, 20],
        zoom: 1.8,
        attributionControl: false,
      });
      m.addControl(new maplibregl.NavigationControl(), "top-right");
      m.on("load", () => {
        if (cancelled) return;
        m.resize();
        mapRef.current = m;
        setMapReady(true);
      });
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  /* ── Plot markers at exact coordinates ── */
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const maplibregl = require("maplibre-gl");

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    mapRef.current.resize();

    const bounds = new maplibregl.LngLatBounds();
    let hasGeo = false;

    for (const evt of events) {
      const lat = evt.lat;
      const lng = evt.lng;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!isFinite(lat) || !isFinite(lng)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      if (lat === 0 && lng === 0) continue;

      hasGeo = true;
      const cat = categorize(evt);
      const color = CAT_COLORS[cat];
      const opacity = eventOpacity(evt);
      const size = Math.max(18, Math.min(32, evt.severity / 3.5));
      const el = document.createElement("div");
      el.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${size * 0.55}px;cursor:pointer;filter:drop-shadow(0 0 4px ${color});transition:transform 0.15s;opacity:${opacity};`;
      el.textContent = CAT_EMOJI[cat];
      const age = evt.created_at ? timeAgo(evt.created_at) : timeAgo(evt.timestamp);
      el.title = `${evt.title} (${age} ago)`;
      el.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); setSelectedEvent(evt); });
      el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.3)"; });
      el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });
      try {
        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(mapRef.current!);
        markersRef.current.push(marker);
        bounds.extend([lng, lat]);
      } catch {}
    }

    if (hasGeo && !bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, { padding: 40, maxZoom: 6, duration: 800 });
    }
  }, [events, mapReady]);

  /* ── Dispatch workflow ── */
  const dispatch = async (workflow: string) => {
    setDispatchMsg(null);
    try {
      const res = await fetch("/api/github/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || res.statusText);
      setDispatchMsg(`Protocol ${workflow.replace(".yml", "")} initiated`);
      setTimeout(() => setDispatchMsg(null), 3000);
      setTimeout(fetchAll, 2000);
    } catch (err) { setDispatchMsg(err instanceof Error ? err.message : String(err)); setTimeout(() => setDispatchMsg(null), 4000); }
  };

  /* ── Derived stats ── */
  const flashCount = fusedSignals.filter(s => s.alert_tier === "FLASH").length;
  const priorityCount = fusedSignals.filter(s => s.alert_tier === "PRIORITY").length;
  const lastRun = engineRuns[0];
  const articlesToday = articles.filter(a => new Date(a.fetched_at).toDateString() === new Date().toDateString()).length;
  const latestDigest = digests[0];
  const lastGhRun = ghRuns[0];

  /* ────── Render ────── */
  return (
    <div className="h-[calc(100vh-48px)] flex flex-col bg-[#050505] text-gray-200 overflow-hidden">
      {/* ════ SYSTEM STATUS BAR ════ */}
      <div className="shrink-0 border-b border-[#00C2FF]/10 bg-[#080808]">
        <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono">
            <span className="bg-[#00C2FF]/10 text-[#00C2FF] px-2 py-0.5 rounded font-bold tracking-wider">J.E.F.F.</span>
            <span className="text-gray-600">|</span>
            <span className="bg-[#00FF41]/10 text-[#00FF41] px-2 py-0.5 rounded-full font-bold">{events.length} SIGNALS</span>
            <span className="bg-white/5 text-gray-400 px-2 py-0.5 rounded-full">{articlesToday} INTERCEPTS TODAY</span>
            {flashCount > 0 && <span className="bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-bold animate-pulse">{flashCount} FLASH</span>}
            {priorityCount > 0 && <span className="bg-orange-500/15 text-orange-400 px-2 py-0.5 rounded-full">{priorityCount} PRIORITY</span>}
            {lastGhRun && (
              <span className={`px-2 py-0.5 rounded-full ${lastGhRun.conclusion === "success" ? "bg-green-500/10 text-green-400" : lastGhRun.conclusion === "failure" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                {lastGhRun.name.split("/").pop()}: {lastGhRun.conclusion || lastGhRun.status}
              </span>
            )}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 shrink-0">
            {dispatchMsg && <span className="text-[10px] text-[#00FF41] font-mono mr-1">{dispatchMsg}</span>}
            <button onClick={() => setShowActions(v => !v)} className="text-[10px] text-[#00C2FF]/70 hover:text-[#00C2FF] px-2 py-1 rounded-md hover:bg-[#00C2FF]/5 transition font-bold uppercase tracking-wider">
              {showActions ? "CLOSE" : "DEPLOY"}
            </button>
            <button onClick={() => fetchAll()} className="text-gray-500 hover:text-[#00FF41] p-1 rounded-md hover:bg-white/5 transition" title="Rescan all systems">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2"><path d="M20 4v5h-5"/><path d="M4 20v-5h5"/><path d="M19 9a8 8 0 0 0-13-3M5 15a8 8 0 0 0 13 3"/></svg>
            </button>
          </div>
        </div>
        {showActions && (
          <div className="flex items-center gap-2 px-3 pb-2 overflow-x-auto no-scrollbar">
            {[
              { w: "pipeline.yml", label: "Run Pipeline", icon: "▶" },
              { w: "daily_email.yml", label: "Daily Briefing", icon: "📧" },
              { w: "weekly_digest.yml", label: "Weekly Debrief", icon: "📋" },
              { w: "ingest.yml", label: "Signal Ingest", icon: "📡" },
              { w: "dreamtime.yml", label: "Dreamtime Analysis", icon: "🌙" },
            ].map(a => (
              <button key={a.w} onClick={() => dispatch(a.w)} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#00C2FF]/15 bg-[#0c0c0c] text-[11px] text-gray-400 hover:border-[#00C2FF]/40 hover:text-[#00C2FF] transition">
                <span>{a.icon}</span> {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ════ MAIN 3-COL LAYOUT ════ */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* ════ LEFT: GLOBAL THREAT MAP ════ */}
      <div className="relative flex-1 min-h-[40vh]">
        <div ref={mapContainer} className="absolute inset-0" style={{ width: "100%", height: "100%" }} />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#050505] z-10">
            <div className="text-[#00C2FF] font-mono animate-pulse text-sm tracking-widest">INITIALIZING GLOBAL SCAN...</div>
          </div>
        )}
        {lastRun && (
          <div className="absolute top-2 left-2 z-20">
            <div className="bg-black/80 backdrop-blur-md rounded-lg px-2.5 py-1 text-[9px] font-mono text-gray-500">
              LAST SCAN: <span className={lastRun.status === "success" ? "text-green-400" : "text-red-400"}>{lastRun.engine.toUpperCase()} {lastRun.status.toUpperCase()}</span> {timeAgo(lastRun.started_at)} AGO
            </div>
          </div>
        )}
        {/* Selected event detail - fixed positioning to prevent jump */}
        {selectedEvent && (
          <div className="absolute bottom-2 left-2 right-2 md:left-auto md:right-2 md:w-80 bg-black/92 backdrop-blur-md border border-[#00C2FF]/20 rounded-xl p-3 z-30 pointer-events-auto">
            <button onClick={() => setSelectedEvent(null)} className="absolute top-2 right-2 text-gray-500 hover:text-white text-sm">&times;</button>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-base">{CAT_EMOJI[categorize(selectedEvent)]}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: CAT_COLORS[categorize(selectedEvent)] }}>
                {categorize(selectedEvent)}
              </span>
              <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(selectedEvent.created_at || selectedEvent.timestamp)} ago</span>
            </div>
            <p className="text-sm text-gray-100 font-semibold leading-snug mb-1 pr-6">{selectedEvent.title}</p>
            {selectedEvent.summary && <p className="text-xs text-gray-400 leading-relaxed">{selectedEvent.summary.slice(0, 250)}</p>}
            <div className="flex items-center gap-1.5 mt-2">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${severityBadge(selectedEvent.severity).cls}`}>{severityBadge(selectedEvent.severity).label}</span>
              {selectedEvent.country_code && selectedEvent.country_code !== "XX" && <span className="text-[10px] text-gray-500">{selectedEvent.country_code}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ════ MIDDLE: LIVE FEED ════ */}
      <div className="w-full md:w-[380px] border-t md:border-t-0 md:border-l border-white/5 flex flex-col overflow-hidden">
        <div className="flex items-center gap-0.5 px-2 pt-2 pb-1 shrink-0">
          {(["fused", "articles", "events"] as const).map(t => (
            <button
              key={t}
              onClick={() => setFeedTab(t)}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition ${feedTab === t ? "bg-[#00C2FF]/10 text-[#00C2FF]" : "text-gray-500 hover:text-gray-300"}`}
            >
              {t === "fused" ? "Threat Matrix" : t === "articles" ? "Intercepts" : "Raw Signals"}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
          {feedTab === "fused" && fusedSignals.map(s => (
            <div key={s.id} className="bg-[#0c0c0c] border border-white/5 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${tierColor(s.alert_tier)}20`, color: tierColor(s.alert_tier) }}>
                  {s.alert_tier}
                </span>
                <span className="text-[10px] text-gray-500 font-mono">{Math.round(s.confidence * 100)}%</span>
                <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(s.created_at)}</span>
              </div>
              <p className="text-xs text-gray-100 font-semibold leading-snug">{s.headline}</p>
              {s.summary && <p className="text-[11px] text-gray-400 mt-1 leading-relaxed line-clamp-2">{s.summary}</p>}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {s.source_engines.map(e => (
                  <span key={e} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500">{e.replace("_", " ")}</span>
                ))}
                {s.corroboration.source_diversity > 1 && (
                  <span className="text-[9px] text-gray-600">{s.corroboration.source_diversity} sources</span>
                )}
              </div>
            </div>
          ))}
          {feedTab === "fused" && fusedSignals.length === 0 && (
            <div className="text-center text-gray-600 text-xs py-8 font-mono">NO FUSED INTEL AVAILABLE — INITIATE DIGEST PROTOCOL</div>
          )}
          {feedTab === "articles" && articles.map(a => (
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="block bg-[#0c0c0c] border border-white/5 rounded-lg p-2.5 hover:border-[#00C2FF]/20 transition">
              <p className="text-xs text-gray-100 font-semibold leading-snug">{a.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-gray-500">{a.source}</span>
                {a.importance_score && <span className="text-[10px] font-mono text-[#00FF41]">{a.importance_score}</span>}
                <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(a.fetched_at)}</span>
              </div>
            </a>
          ))}
          {feedTab === "events" && events.slice(0, 50).map(e => (
            <div
              key={e.id}
              onClick={() => setSelectedEvent(e)}
              className="bg-[#0c0c0c] border border-white/5 rounded-lg p-2.5 cursor-pointer hover:border-white/10 transition"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span>{CAT_EMOJI[categorize(e)]}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${severityBadge(e.severity).cls}`}>{e.severity}</span>
                <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(e.timestamp)}</span>
              </div>
              <p className="text-xs text-gray-200 leading-snug">{e.title}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ════ RIGHT: INTEL RAIL ════ */}
      <div className="hidden lg:flex w-[300px] border-l border-white/5 flex-col overflow-y-auto">
        <div className="p-3 space-y-4">
          {/* Latest Briefing */}
          {latestDigest && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#00FF41]/70 mb-2">LAST BRIEFING</h3>
              <div className="bg-[#0c0c0c] border border-white/5 rounded-lg p-2.5">
                <p className="text-[11px] text-gray-200 font-semibold leading-snug">{latestDigest.subject || "Daily Briefing"}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{timeAgo(latestDigest.created_at)}</p>
                <p className={`text-[10px] text-gray-400 mt-1.5 leading-relaxed whitespace-pre-wrap ${digestExpanded ? "max-h-96 overflow-y-auto" : "line-clamp-4"}`}>
                  {digestExpanded ? latestDigest.plain_text : latestDigest.plain_text.slice(0, 300)}
                </p>
                <button
                  onClick={() => setDigestExpanded(v => !v)}
                  className="text-[10px] text-[#00C2FF] hover:text-[#00FF41] font-bold mt-1.5 transition"
                >
                  {digestExpanded ? "COLLAPSE" : "EXPAND FULL BRIEFING"}
                </button>
              </div>
            </section>
          )}

          {/* Engine Telemetry */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#00FF41]/70 mb-2">SYSTEM TELEMETRY</h3>
            <div className="space-y-1">
              {engineRuns.slice(0, 5).map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[10px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${r.status === "success" ? "bg-green-400" : r.status === "running" ? "bg-yellow-400 animate-pulse" : "bg-red-400"}`} />
                  <span className="text-gray-300 font-mono">{r.engine}</span>
                  <span className="text-gray-600 ml-auto">{r.records_out} out · {timeAgo(r.started_at)}</span>
                </div>
              ))}
              {engineRuns.length === 0 && <p className="text-[10px] text-gray-600 font-mono">AWAITING FIRST ENGINE RUN</p>}
            </div>
          </section>

          {/* Workflow Ops */}
          {ghRuns.length > 0 && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#00C2FF]/70 mb-2">RECENT OPERATIONS</h3>
              <div className="space-y-1">
                {ghRuns.slice(0, 6).map(r => (
                  <a key={r.id} href={r.html_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[10px] hover:bg-white/5 rounded px-1 py-0.5 -mx-1 transition">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.conclusion === "success" ? "bg-green-400" : r.conclusion === "failure" ? "bg-red-400" : "bg-yellow-400"}`} />
                    <span className="text-gray-300 truncate flex-1">{r.name}</span>
                    <span className="text-gray-600 shrink-0">{timeAgo(r.created_at)}</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Active Hypotheses */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#00C2FF]/70 mb-2">ACTIVE HYPOTHESES</h3>
            {hypotheses.slice(0, 5).map(h => (
              <div key={h.id} className="mb-2">
                <p className="text-[11px] text-gray-200 leading-snug">{h.title}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#00C2FF]" style={{ width: `${Math.min(100, h.evidence_score)}%` }} />
                  </div>
                  <span className="text-[9px] text-gray-500 font-mono">{h.evidence_score}</span>
                </div>
              </div>
            ))}
            {hypotheses.length === 0 && <p className="text-[10px] text-gray-600 font-mono">NO ACTIVE HYPOTHESES</p>}
          </section>

          {/* Narrative Arcs */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-purple-400/70 mb-2">NARRATIVE TRACKING</h3>
            {arcs.slice(0, 5).map(a => (
              <div key={a.id} className="mb-1.5 text-[11px]">
                <p className="text-gray-200 leading-snug">{a.title}</p>
                <span className="text-[9px] text-gray-500">Act {a.current_act} · Significance: {a.significance}</span>
              </div>
            ))}
            {arcs.length === 0 && <p className="text-[10px] text-gray-600 font-mono">NO ACTIVE ARCS</p>}
          </section>

          {/* Dreamtime */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-yellow-400/70 mb-2">SCENARIO PROJECTIONS</h3>
            {dreams.slice(0, 3).map(d => (
              <div key={d.id} className="mb-2 bg-[#0c0c0c] border border-white/5 rounded-lg p-2">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[9px] font-bold uppercase text-yellow-400/80">{d.scenario_type}</span>
                  {d.probability > 0 && <span className="text-[9px] text-gray-500 font-mono">{Math.round(d.probability * 100)}%</span>}
                  {d.impact_level && <span className="text-[9px] text-gray-600 ml-auto uppercase">{d.impact_level}</span>}
                </div>
                <p className="text-[11px] text-gray-200 leading-snug">{d.title}</p>
              </div>
            ))}
            {dreams.length === 0 && <p className="text-[10px] text-gray-600 font-mono">NO PROJECTIONS GENERATED</p>}
          </section>
        </div>
      </div>
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(OpsCenter), { ssr: false });

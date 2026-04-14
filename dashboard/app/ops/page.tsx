"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

  const [feedTab, setFeedTab] = useState<"fused" | "articles" | "events">("fused");

  /* ── Data fetching ── */
  const safeFetch = async (url: string) => {
    try { const r = await fetch(url); if (!r.ok) return {}; return await r.json(); } catch { return {}; }
  };

  const fetchAll = useCallback(async () => {
    const [ev, fused, art, runs, hypo, arc, dream] = await Promise.all([
      safeFetch("/api/intel/events?hours=48&limit=500&severity_min=15"),
      safeFetch("/api/intel/fused?hours=48&limit=50"),
      safeFetch("/api/data/articles?limit=30"),
      safeFetch("/api/intel/engine-runs"),
      safeFetch("/api/intel/hypotheses"),
      safeFetch("/api/intel/arcs"),
      safeFetch("/api/intel/dreamtime"),
    ]);

    setEvents(ev.events ?? []);
    setFusedSignals(fused.signals ?? []);
    setArticles(art.articles ?? []);
    setEngineRuns(runs.runs ?? []);
    setHypotheses(hypo.hypotheses ?? []);
    setArcs(arc.arcs ?? []);
    setDreams(dream.scenarios ?? []);
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
        center: [30, 20],
        zoom: 2,
        attributionControl: false,
      });
      m.addControl(new maplibregl.NavigationControl(), "top-right");
      m.on("load", () => { if (!cancelled) { mapRef.current = m; setMapReady(true); } });
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  /* ── Plot markers ── */
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const maplibregl = require("maplibre-gl");
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    for (const evt of events) {
      if (typeof evt.lat !== "number" || typeof evt.lng !== "number" || (evt.lat === 0 && evt.lng === 0)) continue;
      const cat = categorize(evt);
      const color = CAT_COLORS[cat];
      const size = Math.max(18, Math.min(32, evt.severity / 3.5));
      const el = document.createElement("div");
      el.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${size * 0.55}px;cursor:pointer;filter:drop-shadow(0 0 4px ${color});transition:transform 0.15s;`;
      el.textContent = CAT_EMOJI[cat];
      el.title = evt.title;
      el.addEventListener("click", (e) => { e.stopPropagation(); setSelectedEvent(evt); });
      el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.3)"; });
      el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });
      try {
        const marker = new maplibregl.Marker({ element: el }).setLngLat([evt.lng, evt.lat]).addTo(mapRef.current!);
        markersRef.current.push(marker);
      } catch {}
    }
  }, [events, mapReady]);

  /* ── Derived stats ── */
  const flashCount = fusedSignals.filter(s => s.alert_tier === "FLASH").length;
  const priorityCount = fusedSignals.filter(s => s.alert_tier === "PRIORITY").length;
  const lastRun = engineRuns[0];

  /* ────── Render ────── */
  return (
    <div className="h-[calc(100vh-48px)] flex flex-col md:flex-row bg-[#050505] text-gray-200 overflow-hidden">
      {/* ════ LEFT: MAP ════ */}
      <div className="relative flex-1 min-h-[40vh]">
        <div ref={mapContainer} className="absolute inset-0" style={{ width: "100%", height: "100%" }} />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#050505] z-10">
            <div className="text-[#00FF41] font-mono animate-pulse text-sm">LOADING MAP...</div>
          </div>
        )}
        {/* Status bar overlaid on map */}
        <div className="absolute top-2 left-2 right-2 z-20 flex items-center gap-2">
          <div className="bg-black/85 backdrop-blur-md rounded-lg px-3 py-1.5 flex items-center gap-3 text-[10px] font-mono">
            <span className="text-[#00FF41] font-bold">{events.length}</span>
            <span className="text-gray-500">events</span>
            {flashCount > 0 && <span className="text-red-400 font-bold">{flashCount} FLASH</span>}
            {priorityCount > 0 && <span className="text-orange-400">{priorityCount} PRIORITY</span>}
          </div>
          {lastRun && (
            <div className="bg-black/85 backdrop-blur-md rounded-lg px-3 py-1.5 text-[10px] font-mono text-gray-500">
              {lastRun.engine}: <span className={lastRun.status === "success" ? "text-green-400" : "text-red-400"}>{lastRun.status}</span>{" "}
              {timeAgo(lastRun.started_at)} ago
            </div>
          )}
        </div>
        {/* Selected event detail */}
        {selectedEvent && (
          <div className="absolute bottom-2 left-2 right-2 md:left-auto md:right-2 md:w-80 bg-black/92 backdrop-blur-md border border-white/10 rounded-xl p-3 z-30">
            <button onClick={() => setSelectedEvent(null)} className="absolute top-2 right-2 text-gray-500 hover:text-white text-sm">&times;</button>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-base">{CAT_EMOJI[categorize(selectedEvent)]}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: CAT_COLORS[categorize(selectedEvent)] }}>
                {categorize(selectedEvent)}
              </span>
              <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(selectedEvent.timestamp)}</span>
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

      {/* ════ MIDDLE: FEED ════ */}
      <div className="w-full md:w-[380px] border-t md:border-t-0 md:border-l border-white/5 flex flex-col overflow-hidden">
        <div className="flex items-center gap-0.5 px-2 pt-2 pb-1 shrink-0">
          {(["fused", "articles", "events"] as const).map(t => (
            <button
              key={t}
              onClick={() => setFeedTab(t)}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition ${feedTab === t ? "bg-[#00FF41]/10 text-[#00FF41]" : "text-gray-500 hover:text-gray-300"}`}
            >
              {t === "fused" ? "Fused Intel" : t === "articles" ? "News" : "Events"}
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
            <div className="text-center text-gray-600 text-xs py-8">No fused signals yet. Run digest to generate.</div>
          )}
          {feedTab === "articles" && articles.map(a => (
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="block bg-[#0c0c0c] border border-white/5 rounded-lg p-2.5 hover:border-[#00FF41]/20 transition">
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

      {/* ════ RIGHT: RISK RAIL ════ */}
      <div className="hidden lg:flex w-[300px] border-l border-white/5 flex-col overflow-y-auto">
        <div className="p-3 space-y-4">
          {/* Engine health */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#00FF41]/70 mb-2">Engine Status</h3>
            <div className="space-y-1">
              {engineRuns.slice(0, 5).map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[10px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${r.status === "success" ? "bg-green-400" : r.status === "running" ? "bg-yellow-400 animate-pulse" : "bg-red-400"}`} />
                  <span className="text-gray-300 font-mono">{r.engine}</span>
                  <span className="text-gray-600 ml-auto">{r.records_out}out {timeAgo(r.started_at)}</span>
                </div>
              ))}
              {engineRuns.length === 0 && <p className="text-[10px] text-gray-600">No engine runs recorded yet.</p>}
            </div>
          </section>

          {/* Active hypotheses */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#00C2FF]/70 mb-2">Hypotheses</h3>
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
            {hypotheses.length === 0 && <p className="text-[10px] text-gray-600">No active hypotheses.</p>}
          </section>

          {/* Narrative arcs */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-purple-400/70 mb-2">Narrative Arcs</h3>
            {arcs.slice(0, 5).map(a => (
              <div key={a.id} className="mb-1.5 text-[11px]">
                <p className="text-gray-200 leading-snug">{a.title}</p>
                <span className="text-[9px] text-gray-500">Act {a.current_act} | Significance: {a.significance}</span>
              </div>
            ))}
            {arcs.length === 0 && <p className="text-[10px] text-gray-600">No active arcs.</p>}
          </section>

          {/* Dreamtime */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-yellow-400/70 mb-2">Dreamtime Scenarios</h3>
            {dreams.slice(0, 3).map(d => (
              <div key={d.id} className="mb-2 bg-[#0c0c0c] border border-white/5 rounded-lg p-2">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[9px] font-bold uppercase text-yellow-400/80">{d.scenario_type}</span>
                  {d.probability > 0 && <span className="text-[9px] text-gray-500 font-mono">{Math.round(d.probability * 100)}%</span>}
                  {d.impact_level && <span className="text-[9px] text-gray-600 ml-auto">{d.impact_level}</span>}
                </div>
                <p className="text-[11px] text-gray-200 leading-snug">{d.title}</p>
              </div>
            ))}
            {dreams.length === 0 && <p className="text-[10px] text-gray-600">No scenarios generated yet.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(OpsCenter), { ssr: false });

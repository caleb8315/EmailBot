"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

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

type Category = "military" | "conflict" | "fire" | "quake" | "internet" | "other";

function categorize(e: MapEvent): Category {
  if (e.source === "adsb") return "military";
  if (e.type === "airstrike" || e.type === "conflict" || e.type === "protest") return "conflict";
  if (e.source === "firms" || e.type === "fire") return "fire";
  if (e.type === "earthquake") return "quake";
  if (e.source === "ooni" || e.type === "internet_shutdown" || e.type === "internet_disruption") return "internet";
  if (e.source === "sentinel" || e.type === "satellite_change") return "military";
  return "other";
}

const CAT_CONFIG: Record<Category, { label: string; color: string; emoji: string }> = {
  military: { label: "Military/Aircraft", color: "#FF3333", emoji: "✈" },
  conflict: { label: "Battles/Bombings", color: "#FF8800", emoji: "💥" },
  fire: { label: "Fires/Thermal", color: "#FF5500", emoji: "🔥" },
  quake: { label: "Earthquakes", color: "#00BBFF", emoji: "🌊" },
  internet: { label: "Internet Outages", color: "#AA44FF", emoji: "📡" },
  other: { label: "Other Intel", color: "#00FF41", emoji: "📍" },
};

interface SourceConfig {
  label: string;
  emoji: string;
  color: string;
  status: "live" | "degraded" | "offline";
}

const SOURCE_CONFIG: Record<string, SourceConfig> = {
  gdelt:      { label: "GDELT",           emoji: "⚔️",  color: "#FF6633", status: "live" },
  firms:      { label: "FIRMS (NASA)",     emoji: "🔥",  color: "#FF5500", status: "live" },
  usgs:       { label: "USGS Earthquakes", emoji: "🌋",  color: "#00BBFF", status: "live" },
  adsb:       { label: "ADS-B Military",   emoji: "✈️",  color: "#FF3333", status: "live" },
  ais:        { label: "AIS Vessels",      emoji: "🚢",  color: "#2288FF", status: "live" },
  ooni:       { label: "OONI Internet",    emoji: "📡",  color: "#AA44FF", status: "live" },
  sentinel:   { label: "Sentinel SAT",     emoji: "🛰️",  color: "#44AAFF", status: "live" },
  notam:      { label: "NOTAMs",           emoji: "🚫",  color: "#FF8844", status: "live" },
  cisa:       { label: "CISA Cyber",       emoji: "🛡️",  color: "#FF44FF", status: "live" },
  polymarket: { label: "Polymarket",       emoji: "📊",  color: "#44DDAA", status: "live" },
  acled:      { label: "ACLED",            emoji: "⚔️",  color: "#FF5533", status: "offline" },
  ucdp:       { label: "UCDP",            emoji: "⚔️",  color: "#FF4422", status: "live" },
  nasa_eonet: { label: "NASA EONET",       emoji: "🌍",  color: "#44CC88", status: "live" },
  rss:        { label: "RSS/News",         emoji: "📰",  color: "#00FF41", status: "live" },
  emsc:       { label: "EMSC Seismic",    emoji: "🌋",  color: "#0099DD", status: "live" },
  gvp:        { label: "Volcanic (GVP)",  emoji: "🌋",  color: "#FF4400", status: "live" },
  reliefweb:  { label: "ReliefWeb",       emoji: "🏥",  color: "#CC4488", status: "live" },
  nhc:        { label: "NHC Storms",      emoji: "🌀",  color: "#6644FF", status: "live" },
};

function getCoords(evt: MapEvent): { lat: number; lng: number } | null {
  if (typeof evt.lat === "number" && typeof evt.lng === "number" && !(evt.lat === 0 && evt.lng === 0)) {
    return { lat: evt.lat, lng: evt.lng };
  }
  return null;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function MapInner() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any[]>>(new Map());
  const [events, setEvents] = useState<MapEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<MapEvent | null>(null);
  const [enabledCats, setEnabledCats] = useState<Set<Category>>(
    new Set(["military", "conflict", "fire", "quake", "internet", "other"])
  );
  const [enabledSources, setEnabledSources] = useState<Set<string>>(
    new Set(Object.keys(SOURCE_CONFIG))
  );
  const [hoursBack, setHoursBack] = useState(48);
  const [mapReady, setMapReady] = useState(false);
  const [showSatellite, setShowSatellite] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterMode, setFilterMode] = useState<"source" | "category">("source");

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/intel/events?hours=${hoursBack}&limit=500&severity_min=15`);
      if (res.ok) setEvents((await res.json()).events || []);
    } catch {}
    setLoading(false);
  }, [hoursBack]);

  useEffect(() => { fetchEvents(); const i = setInterval(fetchEvents, 60_000); return () => clearInterval(i); }, [fetchEvents]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (!document.querySelector("#maplibre-css")) {
        const link = document.createElement("link");
        link.id = "maplibre-css"; link.rel = "stylesheet";
        link.href = "https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css";
        document.head.appendChild(link);
      }
      if (cancelled || !mapContainer.current) return;

      const m = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8 as const,
          sources: {
            carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png", "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"], tileSize: 256, maxzoom: 19 },
            nasa_gibs: { type: "raster", tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`], tileSize: 256, maxzoom: 9 },
          },
          layers: [{ id: "carto", type: "raster", source: "carto" }],
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        },
        center: [30, 20], zoom: 2, attributionControl: false,
      });
      m.addControl(new maplibregl.NavigationControl(), "top-right");
      m.on("load", () => { if (!cancelled) { mapRef.current = m; setMapReady(true); } });
    })();

    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const maplibregl = require("maplibre-gl");

    for (const [, markers] of markersRef.current) {
      for (const m of markers) m.remove();
    }
    markersRef.current.clear();

    const filtered = events.filter(e =>
      enabledSources.has(e.source) && enabledCats.has(categorize(e))
    );

    for (const evt of filtered) {
      const coords = getCoords(evt);
      if (!coords) continue;

      const cat = categorize(evt);
      const cfg = CAT_CONFIG[cat];
      const srcCfg = SOURCE_CONFIG[evt.source];
      const markerColor = srcCfg?.color || cfg.color;
      const markerEmoji = srcCfg?.emoji || cfg.emoji;
      const size = Math.max(20, Math.min(36, evt.severity / 3));

      const el = document.createElement("div");
      el.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${size * 0.55}px;cursor:pointer;filter:drop-shadow(0 0 4px ${markerColor});transition:transform 0.15s;`;
      el.textContent = markerEmoji;
      el.title = evt.title;
      el.addEventListener("click", (e) => { e.stopPropagation(); setSelectedEvent(evt); });
      el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.4)"; });
      el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });

      try {
        const marker = new maplibregl.Marker({ element: el }).setLngLat([coords.lng, coords.lat]).addTo(mapRef.current!);
        const existing = markersRef.current.get(evt.source) || [];
        existing.push(marker);
        markersRef.current.set(evt.source, existing);
      } catch {}
    }
  }, [events, enabledSources, enabledCats, mapReady]);

  const toggleSource = (src: string) => {
    setEnabledSources(prev => { const next = new Set(prev); if (next.has(src)) next.delete(src); else next.add(src); return next; });
  };

  const toggleCat = (cat: Category) => {
    setEnabledCats(prev => { const next = new Set(prev); if (next.has(cat)) next.delete(cat); else next.add(cat); return next; });
  };

  const toggleSatellite = () => {
    if (!mapRef.current) return;
    const m = mapRef.current; const next = !showSatellite; setShowSatellite(next);
    try {
      if (next) {
        if (!m.getLayer("nasa_sat")) m.addLayer({ id: "nasa_sat", type: "raster", source: "nasa_gibs", paint: { "raster-opacity": 0.5 } }, "carto");
        m.setLayoutProperty("nasa_sat", "visibility", "visible");
      } else { if (m.getLayer("nasa_sat")) m.setLayoutProperty("nasa_sat", "visibility", "none"); }
    } catch {}
  };

  const geoEvents = events.filter(e => getCoords(e) && enabledSources.has(e.source) && enabledCats.has(categorize(e)));

  const sourceCounts: Record<string, number> = {};
  for (const e of geoEvents) { sourceCounts[e.source] = (sourceCounts[e.source] || 0) + 1; }
  const catCounts: Record<string, number> = {};
  for (const e of geoEvents) { const c = categorize(e); catCounts[c] = (catCounts[c] || 0) + 1; }

  const discoveredSources = [...new Set(events.map(e => e.source))].sort();

  return (
    <div className="fixed inset-0 bg-[#050505]">
      <div ref={mapContainer} className="absolute inset-0" style={{ width: "100%", height: "100%" }} />

      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050505] z-10">
          <div className="text-[#00FF41] font-mono animate-pulse text-sm">LOADING MAP...</div>
        </div>
      )}

      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 z-20">
        <div className="bg-black/85 backdrop-blur-md rounded-xl px-3 py-2 flex items-center gap-3 flex-1 min-w-0">
          <span className="text-[#00FF41] font-mono font-bold text-sm">{geoEvents.length}</span>
          <span className="text-gray-500 text-[10px]">events on map</span>
          <div className="flex-1" />
          {discoveredSources.slice(0, 6).map(src => {
            const cfg = SOURCE_CONFIG[src];
            return (
              <span key={src} className="text-[10px] text-gray-500 hidden sm:inline-flex items-center gap-0.5">
                <span>{cfg?.emoji || "📍"}</span> {sourceCounts[src] || 0}
              </span>
            );
          })}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="bg-black/85 backdrop-blur-md rounded-xl px-3 py-2 text-[10px] text-gray-400 font-mono shrink-0"
        >
          {showFilters ? "CLOSE" : "LAYERS"}
        </button>
      </div>

      {showFilters && (
        <div className="absolute top-14 left-3 right-3 md:left-auto md:right-3 md:w-72 bg-black/90 backdrop-blur-md rounded-xl p-3 z-20 space-y-1.5 max-h-[70vh] overflow-y-auto">
          <button
            onClick={toggleSatellite}
            className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${
              showSatellite ? "text-blue-300 bg-blue-500/10" : "text-gray-500"
            }`}
          >
            <span>🛰</span> Satellite Imagery {showSatellite ? "ON" : "OFF"}
          </button>

          <div className="border-t border-white/5 my-1" />
          <div className="flex gap-1 mb-1.5">
            <button onClick={() => setFilterMode("source")}
              className={`flex-1 text-[9px] font-bold uppercase tracking-wider py-1 rounded-md transition ${filterMode === "source" ? "text-[#00C2FF] bg-[#00C2FF]/10" : "text-gray-600"}`}>
              By Source
            </button>
            <button onClick={() => setFilterMode("category")}
              className={`flex-1 text-[9px] font-bold uppercase tracking-wider py-1 rounded-md transition ${filterMode === "category" ? "text-[#00C2FF] bg-[#00C2FF]/10" : "text-gray-600"}`}>
              By Type
            </button>
          </div>

          {filterMode === "source" && discoveredSources.map(src => {
            const cfg = SOURCE_CONFIG[src] || { label: src, emoji: "📍", color: "#888", status: "live" as const };
            const count = sourceCounts[src] || 0;
            const enabled = enabledSources.has(src);
            return (
              <button
                key={src}
                onClick={() => toggleSource(src)}
                className={`flex items-center justify-between w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${
                  enabled ? "text-gray-200" : "text-gray-600"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{cfg.emoji}</span>
                  <span>{cfg.label}</span>
                  {cfg.status === "offline" && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-red-500/20 text-red-400 uppercase font-bold">offline</span>
                  )}
                  {cfg.status === "degraded" && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400 uppercase font-bold">degraded</span>
                  )}
                </span>
                <span className="text-[10px] font-mono" style={{ color: enabled ? cfg.color : "transparent" }}>
                  {count}
                </span>
              </button>
            );
          })}

          {filterMode === "category" && (Object.entries(CAT_CONFIG) as [Category, typeof CAT_CONFIG[Category]][]).map(([cat, cfg]) => (
            <button
              key={cat}
              onClick={() => toggleCat(cat)}
              className={`flex items-center justify-between w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${
                enabledCats.has(cat) ? "text-gray-200" : "text-gray-600"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>{cfg.emoji}</span>
                <span>{cfg.label}</span>
              </span>
              <span className="text-[10px] font-mono" style={{ color: enabledCats.has(cat) ? cfg.color : "transparent" }}>
                {catCounts[cat] || 0}
              </span>
            </button>
          ))}

          <div className="border-t border-white/5 my-1" />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-500">Time: last {hoursBack}h</span>
            </div>
            <input
              type="range" min={1} max={72} value={hoursBack}
              onChange={e => setHoursBack(parseInt(e.target.value))}
              className="w-full h-1.5 accent-[#00FF41] bg-white/10 rounded-full appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[8px] text-gray-600 mt-0.5">
              <span>1h</span><span>24h</span><span>48h</span><span>72h</span>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && (
        <div className="absolute bottom-20 md:bottom-4 left-3 right-3 md:left-auto md:right-3 md:w-96 bg-black/92 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden z-30">
          <div className="p-4">
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white text-sm"
            >
              &times;
            </button>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{(SOURCE_CONFIG[selectedEvent.source] || CAT_CONFIG[categorize(selectedEvent)])?.emoji}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: (SOURCE_CONFIG[selectedEvent.source] || CAT_CONFIG[categorize(selectedEvent)])?.color }}>
                {SOURCE_CONFIG[selectedEvent.source]?.label || CAT_CONFIG[categorize(selectedEvent)]?.label}
              </span>
              <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(selectedEvent.timestamp)}</span>
            </div>

            <p className="text-sm text-gray-100 font-semibold leading-snug mb-2 pr-8">{selectedEvent.title}</p>

            {selectedEvent.summary && (
              <p className="text-xs text-gray-400 leading-relaxed mb-3">{selectedEvent.summary.slice(0, 300)}</p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                selectedEvent.severity >= 80 ? "bg-red-500/20 text-red-400" :
                selectedEvent.severity >= 60 ? "bg-orange-500/20 text-orange-400" :
                selectedEvent.severity >= 40 ? "bg-yellow-500/20 text-yellow-400" :
                "bg-green-500/20 text-green-400"
              }`}>
                {selectedEvent.severity >= 80 ? "Critical" :
                 selectedEvent.severity >= 60 ? "High" :
                 selectedEvent.severity >= 40 ? "Medium" : "Low"}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500 uppercase">{selectedEvent.source}</span>
              {selectedEvent.country_code !== "XX" && (
                <span className="text-[10px] text-gray-500">{selectedEvent.country_code}</span>
              )}
            </div>

            {selectedEvent.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedEvent.tags.filter(t => !["gdelt", "rss", "firms", "adsb", "ooni", "geocoded", "conflict"].includes(t)).slice(0, 5).map(t => (
                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default dynamic(() => Promise.resolve(MapInner), { ssr: false });

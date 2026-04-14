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

const LAYER_COLORS: Record<string, string> = {
  adsb: "#FF4444",
  ais: "#4444FF",
  acled: "#FF8800",
  gdelt: "#FFFF44",
  firms: "#FF6600",
  usgs: "#00AAFF",
  sam_gov: "#FFFF00",
  notam: "#FF44FF",
  rss: "#00FF41",
  sentinel: "#FF44FF",
};

const LAYER_LABELS: Record<string, string> = {
  adsb: "Aircraft",
  ais: "Vessels",
  acled: "Conflicts",
  gdelt: "News",
  firms: "Fire/Thermal",
  usgs: "Earthquakes",
  sam_gov: "Procurement",
  notam: "Airspace",
  rss: "RSS Intel",
};

function getCoords(evt: MapEvent): { lat: number; lng: number } | null {
  if (typeof evt.lat === "number" && typeof evt.lng === "number" &&
      !(evt.lat === 0 && evt.lng === 0)) {
    return { lat: evt.lat, lng: evt.lng };
  }
  return null;
}

function MapInner() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [events, setEvents] = useState<MapEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<MapEvent | null>(null);
  const [enabledLayers, setEnabledLayers] = useState<Set<string>>(
    new Set(Object.keys(LAYER_LABELS))
  );
  const [hoursBack, setHoursBack] = useState(48);
  const [mapReady, setMapReady] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/intel/events?hours=${hoursBack}&limit=500&severity_min=15`
      );
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch {}
    setLoading(false);
  }, [hoursBack]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 60_000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Init map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;

      // Inject CSS manually since Next.js CSS imports in client components can fail
      if (!document.querySelector("#maplibre-css")) {
        const link = document.createElement("link");
        link.id = "maplibre-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css";
        document.head.appendChild(link);
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
                "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              ],
              tileSize: 256,
              attribution: "\u00a9 CartoDB \u00a9 OpenStreetMap",
              maxzoom: 19,
            },
            nasa_gibs: {
              type: "raster",
              tiles: [
                "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
              ],
              tileSize: 256,
              maxzoom: 9,
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

      m.on("load", () => {
        if (!cancelled) {
          mapRef.current = m;
          setMapReady(true);
        }
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;

    const maplibregl = (window as any).maplibregl || require("maplibre-gl");

    // Remove old markers
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const filtered = events.filter(e => enabledLayers.has(e.source));
    let plotted = 0;

    for (const evt of filtered) {
      const coords = getCoords(evt);
      if (!coords) continue;

      const color = LAYER_COLORS[evt.source] || "#FFFFFF";
      const size = Math.max(8, Math.min(22, evt.severity / 4));

      const el = document.createElement("div");
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = "50%";
      el.style.backgroundColor = color;
      el.style.opacity = evt.severity > 70 ? "0.9" : "0.6";
      el.style.border = "1px solid rgba(255,255,255,0.3)";
      el.style.cursor = "pointer";
      if (evt.severity >= 80) el.style.boxShadow = `0 0 8px ${color}`;

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelectedEvent(evt);
      });

      try {
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([coords.lng, coords.lat])
          .addTo(mapRef.current!);
        markersRef.current.push(marker);
        plotted++;
      } catch {}
    }

    console.log(`[map] ${plotted} events plotted on map`);
  }, [events, enabledLayers, mapReady]);

  const [showSatellite, setShowSatellite] = useState(false);

  const toggleLayer = (source: string) => {
    setEnabledLayers(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const toggleSatellite = () => {
    if (!mapRef.current) return;
    const m = mapRef.current;
    const next = !showSatellite;
    setShowSatellite(next);
    try {
      if (next) {
        if (!m.getLayer("nasa_sat")) {
          const today = new Date().toISOString().split("T")[0];
          (m.getSource("nasa_gibs") as any)?.setTiles?.([
            `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${today}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
          ]);
          m.addLayer({ id: "nasa_sat", type: "raster", source: "nasa_gibs", paint: { "raster-opacity": 0.6 } }, "carto");
        }
        m.setLayoutProperty("nasa_sat", "visibility", "visible");
      } else {
        if (m.getLayer("nasa_sat")) m.setLayoutProperty("nasa_sat", "visibility", "none");
      }
    } catch {}
  };

  return (
    <div className="fixed inset-0 bg-[#050505]">
      {/* Map container — full screen */}
      <div ref={mapContainer} className="absolute inset-0" style={{ width: "100%", height: "100%" }} />

      {/* Loading overlay */}
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050505] z-10">
          <div className="text-[#00FF41] font-mono animate-pulse text-sm">INITIALIZING MAP...</div>
        </div>
      )}

      {/* Layer controls — top left */}
      <div className="absolute top-3 left-3 bg-black/85 backdrop-blur-md rounded-xl p-2.5 z-20 max-w-[160px]">
        <p className="text-[9px] text-[#00FF41] font-mono font-bold mb-1.5 px-1">LAYERS</p>
        <button
          onClick={toggleSatellite}
          className={`flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded text-[10px] mb-1 transition-colors ${
            showSatellite ? "text-blue-300 bg-blue-500/10" : "text-gray-600"
          }`}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: showSatellite ? "#60A5FA" : "rgba(255,255,255,0.1)" }} />
          NASA Satellite
        </button>
        <div className="border-t border-white/5 my-1" />
        {Object.entries(LAYER_LABELS).map(([src, label]) => (
          <button
            key={src}
            onClick={() => toggleLayer(src)}
            className={`flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded text-[10px] transition-colors ${
              enabledLayers.has(src) ? "text-gray-200" : "text-gray-600"
            }`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: enabledLayers.has(src) ? LAYER_COLORS[src] : "rgba(255,255,255,0.1)" }}
            />
            {label}
          </button>
        ))}
      </div>

      {/* Event count — top right */}
      <div className="absolute top-3 right-3 bg-black/85 backdrop-blur-md rounded-xl px-3 py-2 z-20">
        <p className="text-[10px] text-gray-400 font-mono">
          <span className="text-[#00FF41] font-bold">
            {events.filter(e => enabledLayers.has(e.source)).length}
          </span>{" "}events
          {loading && <span className="ml-1 animate-pulse">...</span>}
        </p>
      </div>

      {/* Time slider — bottom */}
      <div className="absolute bottom-20 md:bottom-4 left-3 right-3 md:left-auto md:right-3 md:w-72 bg-black/85 backdrop-blur-md rounded-xl p-3 z-20">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] text-gray-500 font-mono">TIME WINDOW</p>
          <p className="text-[10px] text-[#00FF41] font-mono font-bold">{hoursBack}h</p>
        </div>
        <input
          type="range"
          min={1}
          max={72}
          value={hoursBack}
          onChange={e => setHoursBack(parseInt(e.target.value))}
          className="w-full h-1 accent-[#00FF41] bg-white/10 rounded-full appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-[8px] text-gray-600 mt-0.5">
          <span>1h</span><span>24h</span><span>72h</span>
        </div>
      </div>

      {/* Event detail panel */}
      {selectedEvent && (
        <div className="absolute top-14 right-3 left-3 md:left-auto md:w-80 bg-black/92 backdrop-blur-md border border-white/10 rounded-xl p-4 z-30 max-h-[60vh] overflow-y-auto">
          <button
            onClick={() => setSelectedEvent(null)}
            className="absolute top-2 right-3 text-gray-500 hover:text-gray-300 text-lg leading-none"
          >
            &times;
          </button>
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: LAYER_COLORS[selectedEvent.source] || "#FFF" }}
            />
            <span className="text-[10px] text-gray-400 font-mono uppercase">{selectedEvent.source}</span>
            <span className="text-[10px] text-gray-600">{selectedEvent.type}</span>
          </div>
          <p className="text-sm text-gray-200 font-medium leading-snug mb-2 pr-6">{selectedEvent.title}</p>
          {selectedEvent.summary && (
            <p className="text-xs text-gray-400 leading-relaxed mb-3">{selectedEvent.summary.slice(0, 300)}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="text-[#00FF41] font-mono">Sev: {selectedEvent.severity}</span>
            <span className="text-gray-600">{selectedEvent.country_code}</span>
            <span className="text-gray-600">{new Date(selectedEvent.timestamp).toLocaleString()}</span>
          </div>
          {selectedEvent.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedEvent.tags.slice(0, 6).map(t => (
                <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Disable SSR for the map — MapLibre needs the DOM
export default dynamic(() => Promise.resolve(MapInner), { ssr: false });

"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
  location?: unknown;
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

const LAYER_ICONS: Record<string, string> = {
  adsb: "Military Aircraft",
  ais: "Vessels",
  acled: "Conflicts",
  gdelt: "News Events",
  firms: "Thermal/Fire",
  usgs: "Earthquakes",
  sam_gov: "Procurement",
  notam: "Airspace",
  rss: "News",
};

function getSecret(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("dashboard_secret") || "";
}

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [events, setEvents] = useState<MapEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<MapEvent | null>(null);
  const [enabledLayers, setEnabledLayers] = useState<Set<string>>(
    new Set(["adsb", "ais", "acled", "firms", "usgs", "sam_gov", "notam"])
  );
  const [hoursBack, setHoursBack] = useState(24);

  const fetchEvents = useCallback(async () => {
    const secret = getSecret();
    const headers: Record<string, string> = {};
    if (secret) headers["x-dashboard-secret"] = secret;

    try {
      const res = await fetch(
        `/api/intel/events?hours=${hoursBack}&limit=500&severity_min=20`,
        { headers }
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

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
            tileSize: 256,
            attribution: "&copy; CartoDB",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [30, 30],
      zoom: 2.5,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update markers when events or filters change
  useEffect(() => {
    if (!map.current) return;

    // Clear existing markers
    document.querySelectorAll(".jeff-marker").forEach(el => el.remove());

    const filtered = events.filter(e => enabledLayers.has(e.source));

    for (const evt of filtered) {
      // Extract coordinates from PostGIS point or skip
      const coords = parseLocation(evt.location);
      if (!coords) continue;

      const color = LAYER_COLORS[evt.source] || "#FFFFFF";
      const size = Math.max(8, Math.min(24, evt.severity / 5));

      const el = document.createElement("div");
      el.className = "jeff-marker";
      el.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${color};
        opacity: ${evt.severity > 70 ? 0.9 : 0.6};
        border: 1px solid rgba(255,255,255,0.3);
        cursor: pointer;
        ${evt.severity >= 80 ? 'box-shadow: 0 0 8px ' + color + ';' : ''}
      `;

      el.addEventListener("click", () => setSelectedEvent(evt));

      new maplibregl.Marker({ element: el })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map.current!);
    }
  }, [events, enabledLayers]);

  const toggleLayer = (source: string) => {
    setEnabledLayers(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  return (
    <div className="h-screen w-full bg-[#050505] relative">
      {/* Map */}
      <div ref={mapContainer} className="absolute inset-0" />

      {/* Layer controls */}
      <div className="absolute top-4 left-4 bg-black/80 backdrop-blur rounded-lg p-3 space-y-1.5 z-10 max-w-[200px]">
        <p className="text-[10px] text-[#00FF41] font-mono font-bold mb-2">LAYERS</p>
        {Object.entries(LAYER_ICONS).map(([source, label]) => (
          <button
            key={source}
            onClick={() => toggleLayer(source)}
            className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded text-[10px] transition-colors ${
              enabledLayers.has(source) ? "text-gray-200" : "text-gray-600"
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{
                background: enabledLayers.has(source)
                  ? LAYER_COLORS[source]
                  : "rgba(255,255,255,0.1)",
              }}
            />
            {label}
          </button>
        ))}
      </div>

      {/* Time slider */}
      <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-black/80 backdrop-blur rounded-lg p-3 z-10">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] text-gray-400 font-mono">TIME WINDOW</p>
          <p className="text-[10px] text-[#00FF41] font-mono">{hoursBack}h</p>
        </div>
        <input
          type="range"
          min={1}
          max={72}
          value={hoursBack}
          onChange={e => setHoursBack(parseInt(e.target.value))}
          className="w-full accent-[#00FF41]"
        />
        <div className="flex justify-between text-[8px] text-gray-600 mt-0.5">
          <span>1h</span>
          <span>24h</span>
          <span>72h</span>
        </div>
      </div>

      {/* Event count */}
      <div className="absolute top-4 right-4 bg-black/80 backdrop-blur rounded-lg px-3 py-2 z-10">
        <p className="text-[10px] text-gray-400 font-mono">
          <span className="text-[#00FF41]">{events.filter(e => enabledLayers.has(e.source)).length}</span> events
          {loading && <span className="ml-2 animate-pulse">updating...</span>}
        </p>
      </div>

      {/* Event detail panel */}
      {selectedEvent && (
        <div className="absolute top-4 right-4 mt-10 w-80 bg-black/90 backdrop-blur border border-white/10 rounded-lg p-4 z-20">
          <button
            onClick={() => setSelectedEvent(null)}
            className="absolute top-2 right-2 text-gray-500 hover:text-gray-300 text-sm"
          >
            x
          </button>
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: LAYER_COLORS[selectedEvent.source] || "#FFF" }}
            />
            <span className="text-[10px] text-gray-400 font-mono uppercase">{selectedEvent.source}</span>
            <span className="text-[10px] text-gray-600">{selectedEvent.type}</span>
          </div>
          <p className="text-sm text-gray-200 font-medium leading-snug mb-2">{selectedEvent.title}</p>
          <p className="text-xs text-gray-400 leading-relaxed mb-3">{selectedEvent.summary}</p>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-[#00FF41] font-mono">Severity: {selectedEvent.severity}/100</span>
            <span className="text-gray-600">{selectedEvent.country_code}</span>
            <span className="text-gray-600">{new Date(selectedEvent.timestamp).toLocaleString()}</span>
          </div>
          {selectedEvent.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedEvent.tags.map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function parseLocation(location: unknown): { lat: number; lng: number } | null {
  if (!location) return null;

  // PostGIS returns POINT format or GeoJSON
  if (typeof location === "string") {
    const match = location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
    if (match) return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
  }

  if (typeof location === "object" && location !== null) {
    const loc = location as Record<string, unknown>;
    if (loc.coordinates && Array.isArray(loc.coordinates)) {
      return { lng: loc.coordinates[0] as number, lat: loc.coordinates[1] as number };
    }
    if (typeof loc.lat === "number" && typeof loc.lng === "number") {
      return { lat: loc.lat, lng: loc.lng };
    }
  }

  return null;
}

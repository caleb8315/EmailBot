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
  raw_data?: Record<string, unknown>;
}

interface FusedSignal {
  id: string;
  headline: string;
  summary: string;
  category: string;
  verification_label?: "VERIFIED" | "DEVELOPING" | "UNVERIFIED" | "QUARANTINED" | "BLOCKED" | null;
  thread_label?: string | null;
  thread_trajectory?: string | null;
  thread_days?: number | null;
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
  confidence: number;
}

interface NarrativeArc {
  id: string;
  title: string;
  current_act: number;
  total_acts?: number;
  historical_accuracy?: number;
  next_act_predicted?: string;
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

interface EventIcon {
  emoji: string;
  color: string;
  label: string;
}

const ADSB_ICONS: Record<string, EventIcon> = {
  isr:         { emoji: "🛩️", color: "#FF4444", label: "Spy Plane" },
  doomsday:    { emoji: "☢️", color: "#FF0000", label: "Nuclear Command Plane" },
  tanker:      { emoji: "⛽", color: "#FFAA44", label: "Aerial Refueler" },
  special_ops: { emoji: "🦅", color: "#FF3366", label: "Special Ops Aircraft" },
  nato:        { emoji: "🛡️", color: "#4488FF", label: "NATO Aircraft" },
  bomber:      { emoji: "💣", color: "#FF2222", label: "Strategic Bomber" },
  transport:   { emoji: "🛫", color: "#88AAFF", label: "VIP Transport" },
};

const SOURCE_ICONS: Record<string, EventIcon> = {
  firms:      { emoji: "🔥", color: "#FF5500", label: "Active Fire" },
  usgs:       { emoji: "🌋", color: "#00BBFF", label: "Earthquake" },
  ooni:       { emoji: "📡", color: "#AA44FF", label: "Internet Shutdown" },
  cisa:       { emoji: "🛡️", color: "#FF44FF", label: "Cyber Threat Alert" },
  polymarket: { emoji: "📊", color: "#44DDAA", label: "Betting Market Spike" },
  sentinel:   { emoji: "🛰️", color: "#44AAFF", label: "Satellite Detection" },
  notam:      { emoji: "🚫", color: "#FF8844", label: "Airspace Closed" },
  ais:        { emoji: "🚢", color: "#2288FF", label: "Ship Gone Dark" },
  acled:      { emoji: "⚔️", color: "#FF5533", label: "Armed Clash" },
  ucdp:       { emoji: "⚔️", color: "#FF4422", label: "Armed Clash" },
  nasa_eonet: { emoji: "🌍", color: "#44CC88", label: "Natural Disaster" },
};

const TYPE_ICONS: Record<string, EventIcon> = {
  earthquake:               { emoji: "🌋", color: "#00BBFF", label: "Earthquake" },
  fire:                     { emoji: "🔥", color: "#FF5500", label: "Wildfire" },
  airstrike:                { emoji: "💥", color: "#FF3300", label: "Air Strike" },
  conflict:                 { emoji: "⚔️", color: "#FF6633", label: "Armed Conflict" },
  protest:                  { emoji: "✊", color: "#FFCC00", label: "Protest" },
  cyber_advisory:           { emoji: "🛡️", color: "#FF44FF", label: "Cyber Threat" },
  notam_closure:            { emoji: "🚫", color: "#FF8844", label: "Airspace Closed" },
  satellite_change:         { emoji: "🛰️", color: "#44AAFF", label: "Satellite Detection" },
  prediction_market_spike:  { emoji: "📊", color: "#44DDAA", label: "Market Spike" },
  vessel_dark:              { emoji: "🚢", color: "#2288FF", label: "Ship Gone Dark" },
  hospital_ship_movement:   { emoji: "🏥", color: "#FF4488", label: "Hospital Ship Moving" },
  news_signal:              { emoji: "📰", color: "#00FF41", label: "Breaking News" },
};

const KEYWORD_EMOJI: [RegExp, string, string][] = [
  [/missile/i,              "🚀", "#FF2200"],
  [/drone/i,                "🛸", "#FF3355"],
  [/air\s*strike|bomb(er|ing)/i, "✈️", "#FF2200"],
  [/artillery|shell(ing)?/i,"💥", "#FF3300"],
  [/tank/i,                 "🪖", "#FF4400"],
  [/nuclear|wmd|radiolog/i, "☢️", "#FF0000"],
  [/chemical|gas\s*attack|biological/i, "☣️", "#BBFF00"],
  [/assassination|targeted\s*kill/i, "🎯", "#FF0055"],
  [/suicide\s*bomb/i,       "💣", "#FF2222"],
  [/car\s*bomb|ied|explosive/i, "💣", "#FF6600"],
  [/gunfight|firefight|small\s*arms|ambush/i, "🔫", "#FF6633"],
  [/kidnap|abduct|hostage|hijack/i, "🔗", "#FF5577"],
  [/torture|sexual/i,       "⛓️", "#CC4466"],
  [/riot|mob|lynch/i,       "🔥", "#FF8800"],
  [/protest|demonstrat|strike|boycott/i, "✊", "#FFCC00"],
  [/blockade|curfew/i,      "🚧", "#FF8800"],
  [/territory|occup(ied|ation)/i, "🏴", "#CC3300"],
  [/ceasefire/i,            "⚠️", "#FFAA00"],
  [/troops?\s*deploy|buildup/i, "🪖", "#FF5544"],
  [/mass\s*violen|ethnic\s*cleans|genocide/i, "💀", "#FF0000"],
  [/displac|expuls|refugee/i,"🚶", "#CC4400"],
  [/arrest|detain/i,        "🚔", "#FF7744"],
  [/raid/i,                 "🏚️", "#FF5544"],
  [/naval|sea\s*block/i,    "⚓", "#4488FF"],
  [/patrol/i,               "👁️", "#FF8866"],
  [/assault|attack/i,       "👊", "#FF7744"],
];

function resolveIcon(e: MapEvent): EventIcon {
  if (e.source === "adsb") {
    const milType = e.raw_data?.military_type as string | undefined;
    if (milType && ADSB_ICONS[milType]) return ADSB_ICONS[milType];
    return { emoji: "✈️", color: "#FF3333", label: "Military Aircraft" };
  }

  const cameoLabel = e.raw_data?.cameo_label as string | undefined;
  if (cameoLabel) {
    for (const [re, emoji, color] of KEYWORD_EMOJI) {
      if (re.test(cameoLabel)) return { emoji, color, label: cameoLabel };
    }
    return { emoji: "⚔️", color: "#FF6633", label: cameoLabel };
  }

  if (TYPE_ICONS[e.type]) return TYPE_ICONS[e.type];
  if (SOURCE_ICONS[e.source]) return SOURCE_ICONS[e.source];

  const title = e.title || "";
  for (const [re, emoji, color] of KEYWORD_EMOJI) {
    if (re.test(title)) {
      const match = title.match(re);
      return { emoji, color, label: match?.[0] || e.type };
    }
  }

  return { emoji: "📍", color: "#00FF41", label: e.type || "Intel" };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unknown";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

function goldsteinLabel(g: number): string {
  if (g <= -9) return "Extremely hostile";
  if (g <= -7) return "Very hostile";
  if (g <= -5) return "Hostile";
  if (g <= -3) return "Tense";
  if (g <= -1) return "Mildly negative";
  if (g <= 1) return "Neutral";
  return "Cooperative";
}

const VERIFIED_CONFLICT_TYPES = new Set([
  "airstrike", "conflict", "military_flight", "military_flight_isr",
  "tanker_surge", "doomsday_plane", "vessel_dark", "vessel_anomaly",
]);

function isVerifiedConflictEvent(evt: MapEvent): boolean {
  if (VERIFIED_CONFLICT_TYPES.has(evt.type)) return true;
  if (evt.severity >= 75 && evt.type !== "news_signal" && evt.type !== "protest") return true;
  return false;
}

interface IntelBreakdown {
  description: string[];
  details: string[];
}

function buildIntel(evt: MapEvent): IntelBreakdown {
  const rd = evt.raw_data || {};
  const description: string[] = [];
  const details: string[] = [];

  if (evt.source === "gdelt") {
    // Who's involved — always show this prominently if we have actors
    if (rd.actor1 && rd.actor2) {
      description.push(`${rd.actor1} vs ${rd.actor2}`);
    } else if (rd.actor1) {
      description.push(`Actor: ${rd.actor1}`);
    }
    // What happened — use the stored label + location for clarity
    if (rd.cameo_label && rd.location) {
      description.push(`${rd.cameo_label} in ${rd.location}`);
    } else if (evt.summary) {
      // Old events: strip raw codes from summary and show as-is
      description.push(evt.summary);
    }
    if (typeof rd.goldstein === "number") {
      if (isVerifiedConflictEvent(evt)) {
        description.push(`Situation: ${goldsteinLabel(rd.goldstein as number)}`);
      } else {
        description.push(`Goldstein scale: ${rd.goldstein}`);
      }
    }
    if (rd.num_articles) details.push(`Reported by ${rd.num_articles} source${(rd.num_articles as number) > 1 ? "s" : ""}`);
    if (typeof rd.goldstein === "number" && isVerifiedConflictEvent(evt)) details.push(`Hostility index: ${rd.goldstein} / -10`);
  } else if (evt.source === "adsb") {
    if (rd.callsign) description.push(`Callsign ${rd.callsign} detected in flight`);
    if (rd.altitude) description.push(`Flying at ${Math.round((rd.altitude as number) * 3.281).toLocaleString()} ft`);
    if (rd.velocity) details.push(`Speed: ${Math.round((rd.velocity as number) * 1.944)} knots`);
    if (rd.heading != null) details.push(`Heading: ${Math.round(rd.heading as number)}°`);
  } else if (evt.source === "usgs") {
    if (rd.mag && rd.place) description.push(`Magnitude ${rd.mag} earthquake near ${rd.place}`);
    else if (rd.mag) description.push(`Magnitude ${rd.mag} earthquake detected`);
    if (rd.depth) description.push(`Occurred at ${rd.depth} km depth`);
    if (rd.tsunami) description.push("⚠ Tsunami warning has been issued");
    if (rd.felt) details.push(`Felt by ${rd.felt} people`);
    if (rd.alert) details.push(`Alert level: ${rd.alert}`);
  } else if (evt.source === "ucdp") {
    if (rd.side_a && rd.side_b) description.push(`Fighting between ${rd.side_a} and ${rd.side_b}`);
    if (rd.deaths_best) description.push(`Estimated ${rd.deaths_best} casualties reported`);
    if (rd.region) details.push(`Region: ${rd.region}`);
    if (rd.country) details.push(`Country: ${rd.country}`);
  } else if (evt.source === "firms") {
    if (rd.frp) description.push(`Fire radiative power: ${rd.frp} MW — ${(rd.frp as number) >= 100 ? "major blaze" : (rd.frp as number) >= 30 ? "significant fire" : "active fire"}`);
    if (rd.brightness) details.push(`Brightness temp: ${rd.brightness}K`);
    if (rd.confidence) details.push(`Detection confidence: ${rd.confidence}`);
  } else if (evt.source === "polymarket") {
    if (rd.question) description.push(`Betting question: "${rd.question}"`);
    if (rd.current != null && rd.delta) {
      const dir = (rd.delta as number) > 0 ? "up" : "down";
      description.push(`Odds moved ${dir} to ${Math.round((rd.current as number) * 100)}% (${(rd.delta as number) > 0 ? "+" : ""}${Math.round((rd.delta as number) * 100)}% swing)`);
    }
    if (rd.volume) details.push(`Trading volume: $${Number(rd.volume).toLocaleString()}`);
  } else if (evt.source === "ais" || evt.type === "vessel_dark") {
    if (rd.vessel_name) description.push(`Vessel "${rd.vessel_name}" has gone silent`);
    if (rd.hours_silent) description.push(`No signal for ${rd.hours_silent} hours`);
    if (rd.near_chokepoint) description.push(`Last seen near ${rd.near_chokepoint}`);
    if (rd.speed) details.push(`Last speed: ${rd.speed} knots`);
  } else if (evt.source === "sentinel") {
    if (rd.location) description.push(`Satellite detected changes at ${rd.location}`);
    if (rd.change_score) details.push(`Change score: ${rd.change_score}`);
  } else if (evt.source === "cisa") {
    if (evt.summary) description.push(evt.summary);
    else description.push("Cybersecurity advisory issued by CISA");
  } else if (evt.source === "nasa_eonet") {
    if (evt.summary) description.push(evt.summary);
    if (rd.geometry_count) details.push(`Tracked across ${rd.geometry_count} data points`);
    if (rd.first_seen) details.push(`First observed: ${formatTimestamp(rd.first_seen as string)}`);
  } else {
    // Fallback for any other source
    if (evt.summary) description.push(evt.summary);
  }

  if (evt.tags?.length) {
    details.push(`Tags: ${evt.tags.filter((t: string) => !["gdelt", "conflict", "geocoded"].includes(t)).slice(0, 5).join(", ")}`);
  }

  return { description, details };
}

function intelSourceUrl(evt: MapEvent): string | null {
  const rd = evt.raw_data || {};
  if (rd.source_url && typeof rd.source_url === "string" && rd.source_url.startsWith("http")) return rd.source_url as string;
  if (rd.url && typeof rd.url === "string" && (rd.url as string).startsWith("http")) return rd.url as string;
  if (rd.link && typeof rd.link === "string" && (rd.link as string).startsWith("http")) return rd.link as string;
  return null;
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

/* ────── Event Card (expandable) ────── */

function EventCard({ evt }: { evt: MapEvent }) {
  const [open, setOpen] = useState(false);
  const icon = resolveIcon(evt);
  const badge = severityBadge(evt.severity);
  const intel = buildIntel(evt);
  const sourceUrl = intelSourceUrl(evt);
  const hasIntel = intel.description.length > 0 || intel.details.length > 0;

  return (
    <div className="bg-[#0c0c0c] border border-white/5 rounded-lg overflow-hidden hover:border-white/10 transition">
      <div className="p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <span>{icon.emoji}</span>
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: icon.color }}>{icon.label}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badge.cls}`}>{evt.severity}</span>
          <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(evt.created_at || evt.timestamp)}</span>
        </div>
        <p className="text-xs text-gray-200 leading-snug mb-1">{evt.title}</p>
        <p className="text-[9px] text-gray-500">🕐 {formatTimestamp(evt.timestamp)}</p>
      </div>
      {hasIntel && (
        <>
          <button
            onClick={() => setOpen(!open)}
            className="w-full px-2.5 py-1.5 text-[9px] font-bold tracking-wider text-[#00C2FF] bg-[#00C2FF]/5 border-t border-white/5 hover:bg-[#00C2FF]/10 transition"
          >
            {open ? "HIDE INTEL ▲" : "FULL INTEL ▼"}
          </button>
          {open && (
            <div className="px-2.5 pb-2.5 pt-1.5 border-t border-white/5">
              {intel.description.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">What happened</p>
                  {intel.description.map((line, i) => (
                    <p key={i} className="text-[10px] text-gray-200 leading-relaxed">{line}</p>
                  ))}
                </div>
              )}
              {intel.details.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mb-1">Details</p>
                  {intel.details.map((line, i) => (
                    <p key={i} className="text-[10px] text-gray-400 leading-relaxed">· {line}</p>
                  ))}
                </div>
              )}
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 px-2 py-1 text-[9px] text-[#00C2FF] bg-[#00C2FF]/5 border border-[#00C2FF]/12 rounded-md hover:bg-[#00C2FF]/10 transition">
                  Read original source →
                </a>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ────── Source Layer Config ────── */

interface SourceLayerConfig {
  label: string;
  emoji: string;
  color: string;
  status: "live" | "degraded" | "offline";
}

const SOURCE_LAYERS: Record<string, SourceLayerConfig> = {
  gdelt:      { label: "GDELT",      emoji: "⚔️",  color: "#FF6633", status: "live" },
  firms:      { label: "FIRMS",      emoji: "🔥",  color: "#FF5500", status: "live" },
  usgs:       { label: "USGS",       emoji: "🌋",  color: "#00BBFF", status: "live" },
  adsb:       { label: "ADS-B",      emoji: "✈️",  color: "#FF3333", status: "live" },
  ais:        { label: "AIS",        emoji: "🚢",  color: "#2288FF", status: "live" },
  ooni:       { label: "OONI",       emoji: "📡",  color: "#AA44FF", status: "live" },
  sentinel:   { label: "Sentinel",   emoji: "🛰️",  color: "#44AAFF", status: "live" },
  notam:      { label: "NOTAM",      emoji: "🚫",  color: "#FF8844", status: "live" },
  cisa:       { label: "CISA",       emoji: "🛡️",  color: "#FF44FF", status: "live" },
  polymarket: { label: "Polymarket", emoji: "📊",  color: "#44DDAA", status: "live" },
  acled:      { label: "ACLED",      emoji: "⚔️",  color: "#FF5533", status: "offline" },
  ucdp:       { label: "UCDP",       emoji: "⚔️",  color: "#FF4422", status: "live" },
  nasa_eonet: { label: "EONET",      emoji: "🌍",  color: "#44CC88", status: "live" },
  rss:        { label: "RSS/News",  emoji: "📰",  color: "#00FF41", status: "live" },
  emsc:       { label: "EMSC",      emoji: "🌋",  color: "#0099DD", status: "live" },
  gvp:        { label: "GVP",       emoji: "🌋",  color: "#FF4400", status: "live" },
  reliefweb:  { label: "ReliefWeb", emoji: "🏥",  color: "#CC4488", status: "live" },
  nhc:        { label: "NHC",       emoji: "🌀",  color: "#6644FF", status: "live" },
};

/* ────── Main Component ────── */

function OpsCenter() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const popupRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [enabledSources, setEnabledSources] = useState<Set<string>>(new Set(Object.keys(SOURCE_LAYERS)));
  const [showSourcePanel, setShowSourcePanel] = useState(false);

  const [events, setEvents] = useState<MapEvent[]>([]);
  const [fusedSignals, setFusedSignals] = useState<FusedSignal[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [engineRuns, setEngineRuns] = useState<EngineRun[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [arcs, setArcs] = useState<NarrativeArc[]>([]);
  const [dreams, setDreams] = useState<DreamScenario[]>([]);

  const [digests, setDigests] = useState<Digest[]>([]);
  const [ghRuns, setGhRuns] = useState<GHRun[]>([]);
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);
  const [digestExpanded, setDigestExpanded] = useState(false);

  const [feedTab, setFeedTab] = useState<"fused" | "articles" | "events">("fused");
  const [timeFilter, setTimeFilter] = useState<"all" | "today" | "yesterday">("all");
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

  /* ── Time filter logic ── */
  const matchesTimeFilter = useCallback((iso: string) => {
    if (timeFilter === "all") return true;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (timeFilter === "today") return d >= today;
    return d >= yesterday && d < today;
  }, [timeFilter]);

  const filteredEvents = useMemo(() => events.filter(e => matchesTimeFilter(e.created_at || e.timestamp)), [events, matchesTimeFilter]);
  const filteredFused = useMemo(() => fusedSignals.filter(s => matchesTimeFilter(s.created_at)), [fusedSignals, matchesTimeFilter]);
  const filteredArticles = useMemo(() => articles.filter(a => matchesTimeFilter(a.fetched_at)), [articles, matchesTimeFilter]);

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
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }

    mapRef.current.resize();

    const bounds = new maplibregl.LngLatBounds();
    let hasGeo = false;

    const visibleEvents = filteredEvents.filter(e => enabledSources.has(e.source));
    for (const evt of visibleEvents) {
      const lat = evt.lat;
      const lng = evt.lng;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!isFinite(lat) || !isFinite(lng)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      if (lat === 0 && lng === 0) continue;

      hasGeo = true;
      const icon = resolveIcon(evt);
      const opacity = eventOpacity(evt);
      const size = Math.max(18, Math.min(32, evt.severity / 3.5));
      const el = document.createElement("div");
      el.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${size * 0.55}px;cursor:pointer;opacity:${opacity};filter:drop-shadow(0 0 4px ${icon.color});`;
      el.textContent = icon.emoji;
      const age = evt.created_at ? timeAgo(evt.created_at) : timeAgo(evt.timestamp);
      el.title = `${icon.label}: ${evt.title}\n${formatTimestamp(evt.timestamp)} (${age} ago)`;
      el.addEventListener("mouseenter", () => { el.style.filter = `drop-shadow(0 0 8px ${icon.color}) drop-shadow(0 0 12px ${icon.color})`; });
      el.addEventListener("mouseleave", () => { el.style.filter = `drop-shadow(0 0 4px ${icon.color})`; });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        const badge = severityBadge(evt.severity);
        const badgeBg = badge.label === "CRITICAL" ? "rgba(239,68,68,0.2)" : badge.label === "HIGH" ? "rgba(249,115,22,0.2)" : badge.label === "MEDIUM" ? "rgba(234,179,8,0.2)" : "rgba(34,197,94,0.2)";
        const badgeColor = badge.label === "CRITICAL" ? "#f87171" : badge.label === "HIGH" ? "#fb923c" : badge.label === "MEDIUM" ? "#facc15" : "#4ade80";
        const intel = buildIntel(evt);
        const sourceUrl = intelSourceUrl(evt);
        const detailId = `intel-detail-${evt.id}`;
        const eventTime = formatTimestamp(evt.timestamp);
        const hasIntel = intel.description.length > 0 || intel.details.length > 0;
        const html = `<div style="font-family:ui-monospace,monospace;max-width:300px;padding:2px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:14px">${icon.emoji}</span>
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${icon.color}">${icon.label}</span>
            <span style="margin-left:auto;font-size:9px;color:#6b7280">${age} ago</span>
          </div>
          <p style="font-size:12px;font-weight:600;color:#f3f4f6;line-height:1.3;margin:0 0 4px">${evt.title}</p>
          <p style="font-size:9px;color:#6b7280;margin:0 0 6px;">🕐 ${eventTime}</p>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:9999px;background:${badgeBg};color:${badgeColor}">${badge.label}</span>
            <span style="font-size:9px;padding:2px 6px;border-radius:9999px;background:rgba(255,255,255,0.06);color:#9ca3af">${evt.source}</span>
            ${evt.country_code && evt.country_code !== "XX" ? `<span style="font-size:9px;color:#6b7280">${evt.country_code}</span>` : ""}
          </div>
          ${hasIntel ? `<div id="${detailId}" style="display:none;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;margin-top:2px;">
            <p style="font-size:9px;font-weight:700;color:#d1d5db;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em;">What happened</p>
            ${intel.description.map(l => `<p style="font-size:10px;color:#e5e7eb;line-height:1.5;margin:0 0 3px">${l}</p>`).join("")}
            ${intel.details.length > 0 ? `<p style="font-size:9px;font-weight:700;color:#9ca3af;margin:8px 0 4px 0;text-transform:uppercase;letter-spacing:0.05em;">Details</p>
            ${intel.details.map(l => `<p style="font-size:10px;color:#9ca3af;line-height:1.5;margin:0 0 3px">· ${l}</p>`).join("")}` : ""}
            ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;padding:3px 8px;font-size:9px;color:#00C2FF;background:rgba(0,194,255,0.08);border:1px solid rgba(0,194,255,0.12);border-radius:6px;text-decoration:none;">Read original source →</a>` : ""}
          </div>
          <button onclick="var d=document.getElementById('${detailId}');if(d.style.display==='none'){d.style.display='block';this.textContent='Hide Intel ▲'}else{d.style.display='none';this.textContent='Full Intel ▼'}" style="display:block;width:100%;margin-top:6px;padding:4px 0;font-size:9px;font-weight:700;font-family:inherit;color:#00C2FF;background:rgba(0,194,255,0.08);border:1px solid rgba(0,194,255,0.15);border-radius:6px;cursor:pointer;letter-spacing:0.05em;">Full Intel ▼</button>` : ""}
        </div>`;
        const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "340px", className: "jeff-popup" })
          .setLngLat([lng, lat])
          .setHTML(html)
          .addTo(mapRef.current!);
        popupRef.current = popup;
        popup.on("close", () => { popupRef.current = null; });
      });
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
  }, [filteredEvents, mapReady, enabledSources]);

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
  const flashCount = filteredFused.filter(s => s.alert_tier === "FLASH").length;
  const priorityCount = filteredFused.filter(s => s.alert_tier === "PRIORITY").length;
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
            <span className="bg-[#00FF41]/10 text-[#00FF41] px-2 py-0.5 rounded-full font-bold">{filteredEvents.length} SIGNALS</span>
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
        <button
          onClick={() => setShowSourcePanel(v => !v)}
          className="absolute top-2 right-12 z-20 bg-black/80 backdrop-blur-md rounded-lg px-2.5 py-1 text-[9px] font-mono text-[#00C2FF] hover:text-[#00FF41] transition"
        >
          {showSourcePanel ? "CLOSE" : "LAYERS"}
        </button>
        {showSourcePanel && (
          <div className="absolute top-9 right-12 z-20 bg-black/90 backdrop-blur-md rounded-xl p-2.5 w-52 max-h-[60vh] overflow-y-auto space-y-0.5">
            <p className="text-[8px] font-bold uppercase tracking-wider text-gray-600 mb-1">Feed Sources</p>
            {[...new Set(events.map(e => e.source))].sort().map(src => {
              const cfg = SOURCE_LAYERS[src] || { label: src, emoji: "📍", color: "#888", status: "live" as const };
              const count = events.filter(e => e.source === src).length;
              const enabled = enabledSources.has(src);
              return (
                <button
                  key={src}
                  onClick={() => setEnabledSources(prev => { const n = new Set(prev); if (n.has(src)) n.delete(src); else n.add(src); return n; })}
                  className={`flex items-center justify-between w-full text-left px-2 py-1 rounded-md text-[10px] transition ${enabled ? "text-gray-200" : "text-gray-600"}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{cfg.emoji}</span>
                    <span>{cfg.label}</span>
                    {cfg.status === "offline" && <span className="text-[7px] px-1 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">OFF</span>}
                  </span>
                  <span className="font-mono" style={{ color: enabled ? cfg.color : "transparent" }}>{count}</span>
                </button>
              );
            })}
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
              {t === "fused" ? "Top Alerts" : t === "articles" ? "News Wire" : "Live Events"}
            </button>
          ))}
          <span className="mx-1 w-px h-4 bg-white/10" />
          {(["all", "today", "yesterday"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTimeFilter(t)}
              className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition ${timeFilter === t ? "bg-[#00FF41]/10 text-[#00FF41]" : "text-gray-600 hover:text-gray-400"}`}
            >
              {t === "all" ? "48h" : t}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
          {feedTab === "fused" && filteredFused.map(s => (
            <div key={s.id} className="bg-[#0c0c0c] border border-white/5 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${tierColor(s.alert_tier)}20`, color: tierColor(s.alert_tier) }}>
                  {s.alert_tier}
                </span>
                {s.verification_label && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/5 text-gray-300">
                    {s.verification_label}
                  </span>
                )}
                <span className="text-[10px] text-gray-500 font-mono">{Math.round(s.confidence * 100)}%</span>
                <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(s.created_at)}</span>
              </div>
              <p className="text-xs text-gray-100 font-semibold leading-snug">{s.headline}</p>
              {s.summary && <p className="text-[11px] text-gray-400 mt-1 leading-relaxed line-clamp-2">{s.summary}</p>}
              {s.thread_label && (
                <p className="text-[10px] text-[#00C2FF]/90 mt-1 font-mono">Thread: {s.thread_label}</p>
              )}
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
          {feedTab === "fused" && filteredFused.length === 0 && (
            <div className="text-center text-gray-600 text-xs py-8 font-mono">NO FUSED INTEL AVAILABLE — INITIATE DIGEST PROTOCOL</div>
          )}
          {feedTab === "articles" && filteredArticles.map(a => (
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="block bg-[#0c0c0c] border border-white/5 rounded-lg p-2.5 hover:border-[#00C2FF]/20 transition">
              <p className="text-xs text-gray-100 font-semibold leading-snug">{a.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-gray-500">{a.source}</span>
                {a.importance_score && <span className="text-[10px] font-mono text-[#00FF41]">{a.importance_score}</span>}
                <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(a.fetched_at)}</span>
              </div>
            </a>
          ))}
          {feedTab === "events" && filteredEvents.slice(0, 50).map(e => (
            <EventCard key={e.id} evt={e} />
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
                    <div className="h-full rounded-full bg-[#00C2FF]" style={{ width: `${Math.round((h.confidence ?? 0) * 100)}%` }} />
                  </div>
                  <span className="text-[9px] text-gray-500 font-mono">{Math.round((h.confidence ?? 0) * 100)}%</span>
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
                <span className="text-[9px] text-gray-500">
                  Act {a.current_act}{a.total_acts ? `/${a.total_acts}` : ""}
                  {a.historical_accuracy != null ? ` · ${Math.round(a.historical_accuracy * 100)}% accuracy` : ""}
                </span>
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

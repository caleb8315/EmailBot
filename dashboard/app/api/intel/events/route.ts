import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const KEY_BOMBING_PATTERN =
  /\b(airstrike|air strike|drone strike|missile|shell(ing)?|artiller(y|ies)|bomb(ing|ed)?|blast|explosion|detonat(ed|ion))\b/i;
const KEY_MOVEMENT_PATTERN =
  /\b(troop(s)?|deployment|convoy|staging|buildup|sortie|military movement|naval movement)\b/i;
const VERIFIED_BOMBING_MIN_CONFIDENCE = 0.8;
const VERIFIED_BOMBING_MIN_SOURCES = 3;
const VERIFIED_BOMBING_MIN_ARTICLES = 6;
const VERIFIED_BOMBING_MIN_SEVERITY = 70;
const LIKELY_BOMBING_MIN_CONFIDENCE = 0.7;
const LIKELY_BOMBING_MIN_SEVERITY = 88;
const MOVEMENT_MIN_CONFIDENCE = 0.75;
const HIGH_SIGNAL_MILITARY_TYPES = new Set([
  "doomsday_plane",
  "tanker_surge",
  "military_flight_isr",
  "hospital_ship_movement",
  "satellite_change",
]);

/**
 * GET /api/intel/events — query intelligence events with decoded coordinates.
 *
 * Query params:
 *   source       — filter by data source
 *   type         — filter by event type
 *   hours        — look-back window (default 24)
 *   severity_min — minimum severity (default 0)
 *   limit        — max rows (default 100, max 500)
 */
export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const url = new URL(req.url);
    const source = url.searchParams.get("source");
    const type = url.searchParams.get("type");
    const hours = parseInt(url.searchParams.get("hours") || "24", 10);
    const severityMin = parseInt(url.searchParams.get("severity_min") || "0", 10);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);

    const sb = supabaseAdmin();
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const fields = "id, source, type, severity, confidence, country_code, timestamp, created_at, expires_at, title, summary, tags, location, raw_data";

    if (source) {
      let query = sb.from("intel_events").select(fields)
        .eq("source", source)
        .gte("timestamp", cutoff)
        .gte("severity", severityMin)
        .order("timestamp", { ascending: false })
        .limit(limit);
      if (type) query = query.eq("type", type);
      const { data, error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const events = (data ?? [])
        .map(decodeEvent)
        .sort(sortByMapPriority)
        .slice(0, limit);
      return NextResponse.json({ events, count: events.length });
    }

    const geoLimit = Math.min(limit, 300);
    const textLimit = limit - geoLimit;

    const [geoRes, textRes] = await Promise.all([
      sb.from("intel_events").select(fields)
        .not("location", "is", null)
        .gte("timestamp", cutoff)
        .gte("severity", severityMin)
        .order("severity", { ascending: false })
        .limit(geoLimit),
      sb.from("intel_events").select(fields)
        .is("location", null)
        .gte("timestamp", cutoff)
        .gte("severity", severityMin)
        .order("timestamp", { ascending: false })
        .limit(textLimit),
    ]);

    if (geoRes.error) return NextResponse.json({ error: geoRes.error.message }, { status: 500 });

    const geoEvents = (geoRes.data ?? []).map(decodeEvent);
    const textEvents = (textRes.data ?? []).map(decodeEvent);
    const events = [...geoEvents, ...textEvents]
      .sort(sortByMapPriority)
      .slice(0, limit);

    return NextResponse.json({ events, count: events.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function decodeEvent(e: Record<string, unknown>) {
  const coords = extractCoords(e);
  const priority = classifyMapPriority(e);
  return {
    ...e,
    lat: coords.lat,
    lng: coords.lng,
    location: undefined,
    is_key_event: priority.isKeyEvent,
    key_event_reason: priority.reason,
    map_priority: priority.score,
  };
}

function classifyMapPriority(e: Record<string, unknown>): {
  isKeyEvent: boolean;
  reason: string | null;
  score: number;
} {
  const type = typeof e.type === "string" ? e.type : "";
  const title = typeof e.title === "string" ? e.title : "";
  const summary = typeof e.summary === "string" ? e.summary : "";
  const combinedText = `${title} ${summary}`;
  const severity = typeof e.severity === "number" ? e.severity : 0;
  const confidence = typeof e.confidence === "number" ? e.confidence : 0;
  const tags = extractStringArray(e.tags);
  const rawData = asRecord(e.raw_data);
  const numArticles = asNumber(rawData.num_articles);
  const numSources = asNumber(rawData.num_sources);
  const verificationStatus =
    typeof rawData.verification_status === "string" ? rawData.verification_status : "";

  const hasBombingSignal = type === "airstrike" || KEY_BOMBING_PATTERN.test(combinedText);
  const hasVerifiedSignal =
    verificationStatus === "verified" ||
    tags.includes("verified") ||
    tags.includes("promoted_from_quarantine");
  const hasStrongCorroboration =
    confidence >= VERIFIED_BOMBING_MIN_CONFIDENCE &&
    (numSources ?? 0) >= VERIFIED_BOMBING_MIN_SOURCES &&
    (numArticles ?? 0) >= VERIFIED_BOMBING_MIN_ARTICLES;
  const hasModerateCorroboration =
    confidence >= LIKELY_BOMBING_MIN_CONFIDENCE &&
    (numSources ?? 0) >= 2 &&
    (numArticles ?? 0) >= 4;

  const isVerifiedBombing =
    hasBombingSignal &&
    severity >= VERIFIED_BOMBING_MIN_SEVERITY &&
    (hasVerifiedSignal || hasStrongCorroboration);
  const isLikelyBombing =
    hasBombingSignal &&
    severity >= LIKELY_BOMBING_MIN_SEVERITY &&
    hasModerateCorroboration;
  const isSatelliteStrikeSignature =
    (e.source === "firms" || e.source === "sentinel") &&
    tags.includes("possible_strike_signature") &&
    confidence >= VERIFIED_BOMBING_MIN_CONFIDENCE &&
    severity >= 78;

  const isMilitaryMovement =
    (HIGH_SIGNAL_MILITARY_TYPES.has(type) &&
      severity >= 70 &&
      confidence >= MOVEMENT_MIN_CONFIDENCE) ||
    (type === "military_flight" &&
      severity >= 85 &&
      /\b(bomber|special ops|airborne command|tacamo|nuclear)\b/i.test(combinedText)) ||
    (type.startsWith("military_") && severity >= 75 && KEY_MOVEMENT_PATTERN.test(combinedText));

  const isKeyEvent = isVerifiedBombing || isLikelyBombing || isSatelliteStrikeSignature || isMilitaryMovement;
  const reason = isVerifiedBombing
    ? "Verified bombing/strike"
    : isLikelyBombing
      ? "Likely high-impact bombing"
      : isSatelliteStrikeSignature
        ? "Satellite strike signature"
      : isMilitaryMovement
        ? "Military movement signal"
        : null;

  let score = severity;
  if (isVerifiedBombing) score += 400;
  else if (isLikelyBombing) score += 320;
  else if (isSatelliteStrikeSignature) score += 300;
  else if (isMilitaryMovement) score += 260;
  if (hasVerifiedSignal || hasStrongCorroboration) score += 40;
  if (confidence >= 0.85) score += 25;
  if ((numSources ?? 0) >= 3) score += 20;

  return { isKeyEvent, reason, score };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function sortByMapPriority(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const scoreA = typeof a.map_priority === "number" ? a.map_priority : 0;
  const scoreB = typeof b.map_priority === "number" ? b.map_priority : 0;
  if (scoreA !== scoreB) return scoreB - scoreA;

  const severityA = typeof a.severity === "number" ? a.severity : 0;
  const severityB = typeof b.severity === "number" ? b.severity : 0;
  if (severityA !== severityB) return severityB - severityA;

  const tsA = typeof a.timestamp === "string" ? new Date(a.timestamp).getTime() : 0;
  const tsB = typeof b.timestamp === "string" ? new Date(b.timestamp).getTime() : 0;
  return tsB - tsA;
}

/**
 * Extract lat/lng from the event row, trying multiple strategies:
 * 1. Direct lat/lng columns (if the migration has been applied)
 * 2. EWKB hex from the geography column (PostGIS default output)
 * 3. GeoJSON object (some Supabase configs return this)
 */
function extractCoords(e: Record<string, unknown>): { lat: number | null; lng: number | null } {
  if (typeof e.lat === "number" && typeof e.lng === "number" &&
      isFinite(e.lat) && isFinite(e.lng) &&
      Math.abs(e.lat) <= 90 && Math.abs(e.lng) <= 180) {
    return { lat: e.lat, lng: e.lng };
  }

  const loc = e.location;

  if (typeof loc === "string" && loc.length >= 50) {
    const coords = decodeEWKB(loc);
    if (coords) return coords;
  }

  if (typeof loc === "object" && loc !== null) {
    const geo = loc as { type?: string; coordinates?: number[] };
    if (geo.type === "Point" && Array.isArray(geo.coordinates) && geo.coordinates.length >= 2) {
      const [lng, lat] = geo.coordinates;
      if (isValidCoord(lat, lng)) return { lat, lng };
    }
  }

  return { lat: null, lng: null };
}

function isValidCoord(lat: number, lng: number): boolean {
  return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function decodeEWKB(hex: string): { lat: number; lng: number } | null {
  try {
    const byteOrder = hex.slice(0, 2);
    const isLE = byteOrder === "01";
    let offset = 2;

    const typeHex = hex.slice(offset, offset + 8);
    offset += 8;
    const typeVal = isLE ? parseInt(reverseHexBytes(typeHex), 16) : parseInt(typeHex, 16);
    const hasSRID = (typeVal & 0x20000000) !== 0;
    if (hasSRID) offset += 8;

    const xHex = hex.slice(offset, offset + 16);
    offset += 16;
    const yHex = hex.slice(offset, offset + 16);

    if (xHex.length < 16 || yHex.length < 16) return null;

    const lng = hexToDouble(xHex, isLE);
    const lat = hexToDouble(yHex, isLE);

    if (!isValidCoord(lat, lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function reverseHexBytes(hex: string): string {
  const bytes: string[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(hex.slice(i, i + 2));
  return bytes.reverse().join("");
}

function hexToDouble(hex: string, littleEndian: boolean): number {
  const ordered = littleEndian ? hex : reverseHexBytes(hex);
  const buf = Buffer.from(ordered, "hex");
  return buf.readDoubleLE(0);
}

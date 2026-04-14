import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
      const events = (data ?? []).map(decodeEvent);
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
    const events = [...geoEvents, ...textEvents];

    return NextResponse.json({ events, count: events.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function decodeEvent(e: Record<string, unknown>) {
  const coords = extractCoords(e);
  return { ...e, lat: coords.lat, lng: coords.lng, location: undefined };
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

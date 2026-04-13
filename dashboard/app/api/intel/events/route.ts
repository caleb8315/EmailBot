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

    let query = sb
      .from("intel_events")
      .select("id, source, type, severity, confidence, country_code, timestamp, title, summary, tags, location")
      .gte("timestamp", cutoff)
      .gte("severity", severityMin)
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (source) query = query.eq("source", source);
    if (type) query = query.eq("type", type);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const events = (data ?? []).map((e) => ({
      ...e,
      lat: decodeWKBLat(e.location),
      lng: decodeWKBLng(e.location),
    }));

    return NextResponse.json({ events, count: events.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Decode lat from PostGIS WKB hex (SRID 4326 POINT).
 * Format: 0101000020E6100000 + 8 bytes longitude (little-endian) + 8 bytes latitude (little-endian)
 */
function decodeWKBLng(wkb: unknown): number | null {
  if (typeof wkb !== "string" || wkb.length < 50) return null;
  try {
    const hex = wkb.slice(18, 34); // bytes 9-16: longitude
    return readFloat64LE(hex);
  } catch {
    return null;
  }
}

function decodeWKBLat(wkb: unknown): number | null {
  if (typeof wkb !== "string" || wkb.length < 50) return null;
  try {
    const hex = wkb.slice(34, 50); // bytes 17-24: latitude
    return readFloat64LE(hex);
  } catch {
    return null;
  }
}

function readFloat64LE(hex: string): number {
  const buf = Buffer.from(hex, "hex");
  return buf.readDoubleLE(0);
}

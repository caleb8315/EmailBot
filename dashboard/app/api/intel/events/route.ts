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

    const fields = "id, source, type, severity, confidence, country_code, timestamp, title, summary, tags, location";

    if (source) {
      // Single-source query
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

    // Default: fetch geolocated events first, then fill remaining with non-geo
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
  return {
    ...e,
    lat: decodeWKBCoord(e.location as string, "lat"),
    lng: decodeWKBCoord(e.location as string, "lng"),
  };
}

/**
 * Decode coordinates from PostGIS WKB hex (SRID 4326 POINT).
 * Format: 0101000020E6100000 (18 hex chars header) + 16 hex longitude + 16 hex latitude
 */
function decodeWKBCoord(wkb: unknown, which: "lat" | "lng"): number | null {
  if (typeof wkb !== "string" || wkb.length < 50) return null;
  try {
    const offset = which === "lng" ? 18 : 34;
    const buf = Buffer.from(wkb.slice(offset, offset + 16), "hex");
    return buf.readDoubleLE(0);
  } catch {
    return null;
  }
}

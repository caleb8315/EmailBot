import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/intel/events — spatial query for intelligence events.
 *
 * Query params:
 *   lat, lng, radius_km — spatial filter (PostGIS ST_DWithin)
 *   source              — filter by data source
 *   type                — filter by event type
 *   hours               — look-back window (default 24)
 *   severity_min        — minimum severity (default 0)
 *   limit               — max rows (default 100, max 500)
 */
export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const url = new URL(req.url);
    const lat = url.searchParams.get("lat");
    const lng = url.searchParams.get("lng");
    const radiusKm = url.searchParams.get("radius_km");
    const source = url.searchParams.get("source");
    const type = url.searchParams.get("type");
    const hours = parseInt(url.searchParams.get("hours") || "24", 10);
    const severityMin = parseInt(url.searchParams.get("severity_min") || "0", 10);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);

    const sb = supabaseAdmin();
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Spatial query via PostGIS RPC if lat/lng/radius provided
    if (lat && lng && radiusKm) {
      const { data, error } = await sb.rpc("get_events_in_radius", {
        p_lat: parseFloat(lat),
        p_lng: parseFloat(lng),
        p_radius_m: parseFloat(radiusKm) * 1000,
        p_since: cutoff,
        p_severity_min: severityMin,
        p_source: source || null,
        p_type: type || null,
        p_limit: limit,
      });

      if (error) {
        // Fallback: if the RPC doesn't exist yet, do a basic query
        if (error.message.includes("does not exist")) {
          return fallbackQuery(sb, cutoff, severityMin, source, type, limit);
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ events: data ?? [], count: data?.length ?? 0 });
    }

    // Non-spatial query
    return fallbackQuery(sb, cutoff, severityMin, source, type, limit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function fallbackQuery(
  sb: ReturnType<typeof supabaseAdmin>,
  cutoff: string,
  severityMin: number,
  source: string | null,
  type: string | null,
  limit: number,
) {
  let query = sb
    .from("intel_events")
    .select("*")
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

  return NextResponse.json({ events: data ?? [], count: data?.length ?? 0 });
}

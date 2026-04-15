import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (auth) return auth;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ signals: [] });

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key);

    const { searchParams } = new URL(req.url);
    const hours = Math.min(Number(searchParams.get("hours") || "24"), 168);
    const limit = Math.min(Number(searchParams.get("limit") || "50"), 200);
    const tier = searchParams.get("tier");

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    let query = sb
      .from("fused_signals")
      .select("*")
      .gte("created_at", cutoff)
      .eq("dismissed", false)
      .order("severity", { ascending: false })
      .limit(limit);

    if (tier) query = query.eq("alert_tier", tier);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ signals: [], error: error.message }, { status: 500 });
    }

    const signals = (data ?? []).map((row: any) => {
      const corroboration = row?.corroboration && typeof row.corroboration === "object"
        ? row.corroboration
        : {};
      return {
        ...row,
        verification_label:
          row?.verification_label ??
          corroboration?.verification_label ??
          null,
        thread_label:
          row?.thread_label ??
          corroboration?.thread_label ??
          null,
        thread_trajectory:
          row?.thread_trajectory ??
          corroboration?.thread_trajectory ??
          null,
        thread_days:
          row?.thread_days ??
          corroboration?.thread_days ??
          null,
      };
    });

    return NextResponse.json({ signals });
  } catch (e) {
    return NextResponse.json({ signals: [], error: String(e) }, { status: 500 });
  }
}

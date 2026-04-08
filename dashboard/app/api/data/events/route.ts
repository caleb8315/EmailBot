import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("system_events")
      .select("id, created_at, level, source, message, meta")
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ events: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

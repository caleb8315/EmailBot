import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "active";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("beliefs")
      .select("*")
      .eq("status", status)
      .order("confidence", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ beliefs: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

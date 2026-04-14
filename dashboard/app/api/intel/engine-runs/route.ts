import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (auth) return auth;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ runs: [] });

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key);

    const { data, error } = await sb
      .from("engine_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(30);

    if (error) {
      return NextResponse.json({ runs: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ runs: data ?? [] });
  } catch (e) {
    return NextResponse.json({ runs: [], error: String(e) }, { status: 500 });
  }
}

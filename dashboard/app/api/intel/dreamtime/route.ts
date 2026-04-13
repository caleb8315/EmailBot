import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("dreamtime_scenarios")
      .select("*")
      .order("generated_date", { ascending: false })
      .limit(15);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ scenarios: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

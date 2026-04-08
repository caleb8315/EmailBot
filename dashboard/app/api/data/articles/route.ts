import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  const limit = Math.min(
    60,
    Math.max(5, parseInt(new URL(req.url).searchParams.get("limit") ?? "25", 10))
  );

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("article_history")
      .select(
        "url, title, source, summary, importance_score, credibility_score, alerted, emailed, fetched_at, processed_at"
      )
      .order("fetched_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ articles: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (auth) return auth;

  const url = new URL(req.url);
  const limit = Math.min(
    200,
    Math.max(5, parseInt(url.searchParams.get("limit") ?? "50", 10))
  );
  const minImportance = parseFloat(url.searchParams.get("min_importance") ?? "0");
  const sourceFilter = url.searchParams.get("source")?.trim() || null;
  const sort = url.searchParams.get("sort") ?? "date";

  try {
    const sb = supabaseAdmin();
    let query = sb
      .from("article_history")
      .select(
        "url, title, source, summary, importance_score, credibility_score, alerted, emailed, fetched_at, processed_at"
      );

    if (minImportance > 0) {
      query = query.gte("importance_score", minImportance);
    }
    if (sourceFilter) {
      query = query.ilike("source", `%${sourceFilter}%`);
    }

    if (sort === "importance") {
      query = query.order("importance_score", { ascending: false, nullsFirst: false });
    } else {
      query = query.order("fetched_at", { ascending: false });
    }

    query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ articles: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

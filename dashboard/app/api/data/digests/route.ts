import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("digest_archive")
      .select("id, created_at, channels, subject, plain_text, html_body, article_urls, meta")
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ digests: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

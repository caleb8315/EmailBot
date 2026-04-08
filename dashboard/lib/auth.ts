import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function requireAuth(req: Request): NextResponse | null {
  // Legacy: DASHBOARD_SECRET header still works for API/automation
  const expected = process.env.DASHBOARD_SECRET?.trim();
  const got =
    req.headers.get("x-dashboard-secret")?.trim() ||
    new URL(req.url).searchParams.get("secret")?.trim();
  if (expected && got === expected) return null;

  // Supabase session via cookie
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Supabase not configured — fall back to secret-only auth
    if (!expected) {
      return NextResponse.json(
        { error: "No auth method configured (set DASHBOARD_SECRET or Supabase env vars)" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check for Supabase auth cookie presence (middleware already validated session)
  const cookieStore = cookies();
  const hasAuthCookie = cookieStore
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));

  if (!hasAuthCookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export const requireDashboardSecret = requireAuth;

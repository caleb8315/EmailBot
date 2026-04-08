import { NextResponse } from "next/server";

export function requireDashboardSecret(req: Request): NextResponse | null {
  const expected = process.env.DASHBOARD_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "DASHBOARD_SECRET is not configured on the server" },
      { status: 503 }
    );
  }
  const got =
    req.headers.get("x-dashboard-secret")?.trim() ||
    new URL(req.url).searchParams.get("secret")?.trim();
  if (got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

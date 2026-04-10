import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";

const ALLOWED = new Set([
  "pipeline.yml",
  "daily_email.yml",
  "weekly_digest.yml",
]);

export async function POST(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  const token = process.env.GITHUB_TOKEN?.trim();
  const repoFull = process.env.GITHUB_REPO?.trim();
  if (!token || !repoFull) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN and GITHUB_REPO (owner/name) required" },
      { status: 503 }
    );
  }

  const parts = repoFull.split("/");
  if (parts.length !== 2) {
    return NextResponse.json(
      { error: "GITHUB_REPO must be like yourname/Jeff_Agent1" },
      { status: 400 }
    );
  }
  const [owner, repo] = parts;

  try {
    const body = (await req.json()) as { workflow?: string };
    const workflow = body.workflow?.trim() ?? "";
    if (!ALLOWED.has(workflow)) {
      return NextResponse.json(
        { error: `workflow must be one of: ${Array.from(ALLOWED).join(", ")}` },
        { status: 400 }
      );
    }

    const ref = process.env.GITHUB_DISPATCH_REF?.trim() || "main";
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref }),
      }
    );

    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: `GitHub ${res.status}`, detail: t.slice(0, 500) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, workflow, ref });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

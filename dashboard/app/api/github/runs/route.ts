import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  const token = process.env.GITHUB_TOKEN?.trim();
  const repoFull = process.env.GITHUB_REPO?.trim();
  if (!token || !repoFull) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN and GITHUB_REPO not set", runs: [] },
      { status: 200 }
    );
  }

  const parts = repoFull.split("/");
  if (parts.length !== 2) {
    return NextResponse.json({ error: "Invalid GITHUB_REPO", runs: [] }, { status: 400 });
  }
  const [owner, repo] = parts;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=12`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: t.slice(0, 200), runs: [] },
        { status: 200 }
      );
    }

    const data = (await res.json()) as {
      workflow_runs?: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        created_at: string;
        html_url: string;
      }>;
    };

    return NextResponse.json({ runs: data.workflow_runs ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, runs: [] }, { status: 200 });
  }
}

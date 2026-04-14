import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { resolvePrediction } from "../../../../../../../lib/prediction-ledger";

const VALID_OUTCOMES = new Set(["correct", "incorrect", "partial", "unresolvable"]);

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const { id } = params;
    if (!id) {
      return NextResponse.json({ error: "prediction id required" }, { status: 400 });
    }

    const body = (await req.json()) as { outcome?: string; notes?: string };
    const outcome = body.outcome?.trim();

    if (!outcome || !VALID_OUTCOMES.has(outcome)) {
      return NextResponse.json(
        { error: `outcome must be one of: ${[...VALID_OUTCOMES].join(", ")}` },
        { status: 400 }
      );
    }

    await resolvePrediction(
      id,
      outcome as "correct" | "incorrect" | "partial" | "unresolvable",
      body.notes?.trim()
    );

    return NextResponse.json({ ok: true, id, outcome });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

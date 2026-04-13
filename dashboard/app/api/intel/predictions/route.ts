import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const wantCalibration = url.searchParams.get("calibration") === "true";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    const sb = supabaseAdmin();

    if (wantCalibration) {
      const { data: profile } = await sb.from("user_profile").select("*").limit(1).single();
      const { data: resolved } = await sb
        .from("predictions")
        .select("predictor, brier_score")
        .not("brier_score", "is", null);

      let jeffAvg = 0, userAvg = 0, jeffCount = 0, userCount = 0;
      for (const p of resolved || []) {
        if (p.predictor === "jeff") { jeffAvg += p.brier_score; jeffCount++; }
        else { userAvg += p.brier_score; userCount++; }
      }

      return NextResponse.json({
        calibration: {
          overall_brier_score: profile?.calibration_score ? 1 - profile.calibration_score : 0.5,
          by_region: profile?.calibration_by_region || {},
          by_topic: profile?.calibration_by_topic || {},
          total_predictions: profile?.total_predictions || 0,
          correct_predictions: profile?.correct_predictions || 0,
          jeff_vs_user: {
            jeff_avg: jeffCount > 0 ? jeffAvg / jeffCount : 0.5,
            user_avg: userCount > 0 ? userAvg / userCount : 0.5,
          },
        },
      });
    }

    let query = sb.from("predictions").select("*").order("made_at", { ascending: false }).limit(limit);

    if (status === "active") {
      query = query.is("resolved_at", null);
    } else if (status === "resolved") {
      query = query.not("resolved_at", "is", null);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: profile } = await sb.from("user_profile").select("calibration_score, total_predictions").limit(1).single();

    return NextResponse.json({
      predictions: data ?? [],
      profile: profile || {},
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

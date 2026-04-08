import { NextResponse } from "next/server";
import { requireDashboardSecret } from "@/lib/auth";
import { runBriefingAssistant } from "../../../../src/ai_conversation";

export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = requireDashboardSecret(req);
  if (auth) return auth;

  try {
    const body = (await req.json()) as { message?: string };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const userId =
      process.env.TELEGRAM_CHAT_ID?.trim() || process.env.DEFAULT_USER_ID || "default";
    const reply = await runBriefingAssistant(userId, message);
    return NextResponse.json({ reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

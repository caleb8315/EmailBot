import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runBriefingAssistant } from "../../../../src/ai_conversation";

export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = requireAuth(req);
  if (auth) return auth;

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured on server" },
      { status: 503 }
    );
  }

  if (!process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      { error: "Supabase credentials not configured on server" },
      { status: 503 }
    );
  }

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

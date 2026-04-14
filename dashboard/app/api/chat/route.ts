import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runBriefingAssistant } from "../../../../src/ai_conversation";
import type { AssistantResult } from "../../../../src/ai_conversation";
import { hasLLMCredentials } from "../../../../src/llm_client";
import { resolvePreferenceUserId } from "../../../../src/user_identity";

export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = requireAuth(req);
  if (auth) return auth;

  if (!hasLLMCredentials()) {
    return NextResponse.json(
      { error: "LLM API key not configured on server" },
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
    const body = (await req.json()) as { message?: string; stream?: boolean };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const userId = resolvePreferenceUserId();
    const wantStream = body.stream === true;

    if (wantStream) {
      const result = await runBriefingAssistant(userId, message, { withCitations: true }) as AssistantResult;

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const chunks = chunkText(result.reply, 80);
          let i = 0;
          const interval = setInterval(() => {
            if (i < chunks.length) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: chunks[i] })}\n\n`));
              i++;
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "citations", citations: result.citations })}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              clearInterval(interval);
            }
          }, 25);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const result = await runBriefingAssistant(userId, message, { withCitations: true }) as AssistantResult;
    return NextResponse.json({ reply: result.reply, citations: result.citations });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function chunkText(text: string, targetSize: number): string[] {
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + targetSize, text.length);
    if (end < text.length) {
      const spaceIdx = text.lastIndexOf(" ", end);
      if (spaceIdx > pos) end = spaceIdx + 1;
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks;
}

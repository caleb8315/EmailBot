import { NextResponse } from "next/server";
import { handleMessage } from "../../../../../src/chat_handler";

export const maxDuration = 60;

/**
 * Telegram Bot API webhook. After deploy, run:
 *   curl -F "url=https://YOUR_DOMAIN/api/telegram/webhook" \
 *        -F "secret_token=YOUR_TELEGRAM_WEBHOOK_SECRET" \
 *        https://api.telegram.org/bot<TOKEN>/setWebhook
 */
export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (expected) {
    const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token")?.trim();
    if (got !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN missing" }, { status: 503 });
  }

  try {
    const update = (await req.json()) as {
      message?: {
        chat: { id: number };
        from?: { id: number };
        text?: string;
      };
    };

    const msg = update.message;
    const text = msg?.text;
    if (msg && text) {
      const userId = String(msg.from?.id ?? msg.chat.id);
      const reply = await handleMessage(userId, msg.chat.id, text);
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, text: reply }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

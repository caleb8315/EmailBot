/**
 * Quick Telegram check: validates token (getMe) and optionally sends you a test message.
 *
 * Run from repo root (loads .env via Node):
 *   npm run test:telegram
 *
 * Or export vars yourself:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npx ts-node src/test_telegram.ts
 */

import { createLogger } from "./logger";

const logger = createLogger("test_telegram");

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token) {
    logger.error("Missing TELEGRAM_BOT_TOKEN");
    console.error("\nSet TELEGRAM_BOT_TOKEN in .env or your shell.");
    process.exit(1);
  }

  const base = `https://api.telegram.org/bot${token}`;

  // 1) Token valid?
  const meRes = await fetch(`${base}/getMe`);
  const meJson = (await meRes.json()) as {
    ok?: boolean;
    result?: { username?: string; id?: number };
    description?: string;
  };

  if (!meJson.ok || !meJson.result) {
    logger.error("getMe failed", { description: meJson.description });
    console.error(
      "\nToken rejected by Telegram. Regenerate at @BotFather and update TELEGRAM_BOT_TOKEN."
    );
    process.exit(1);
  }

  console.log(
    `\nOK — bot @${meJson.result.username ?? "?"} (id ${meJson.result.id})\n`
  );

  if (!chatId) {
    console.log(
      "TELEGRAM_CHAT_ID not set — add your numeric chat id to .env to test sendMessage.\n" +
        "Send any message to the bot, then open:\n" +
        `  https://api.telegram.org/bot<TOKEN>/getUpdates\n` +
        "and copy chat.id from the JSON.\n"
    );
    process.exit(0);
  }

  // 2) Can we message this chat?
  const text =
    "Jeff Intelligence — connectivity test OK. Reply with /help if the bot is running (npm run bot).";
  const sendRes = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  const sendJson = (await sendRes.json()) as {
    ok?: boolean;
    description?: string;
    error_code?: number;
  };

  if (!sendJson.ok) {
    logger.error("sendMessage failed", {
      description: sendJson.description,
      code: sendJson.error_code,
    });
    console.error(`
Common fixes:
  • Open Telegram, find your bot, press Start and send any message (private chats often need this first).
  • TELEGRAM_CHAT_ID must match the chat where you messaged the bot (from getUpdates).
  • For groups, the id is usually negative; add the bot to the group first.
  • If you set TELEGRAM_ALLOWED_CHAT_IDS, your id must be listed there for the full bot.
`);
    process.exit(1);
  }

  console.log(`OK — test message sent to chat_id ${chatId}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

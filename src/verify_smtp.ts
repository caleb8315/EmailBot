/**
 * Preflight SMTP check. Run with `npx ts-node src/verify_smtp.ts`.
 *
 * Exits 0 when the transport logs in successfully, 1 when it fails. Prints a
 * Gmail-aware hint when the failure is a known app-password/auth error so the
 * digest workflow fails fast (within seconds) rather than after the AI briefing
 * has already been generated.
 *
 * A missing SMTP configuration is treated as non-fatal (exit 0) because the
 * digest runner also supports Telegram-only delivery.
 */

import { createLogger } from "./logger";
import { createSmtpTransport, diagnoseSmtpError, resolveSmtpConfig } from "./smtp";

const logger = createLogger("verify_smtp");

async function main(): Promise<number> {
  const cfg = resolveSmtpConfig();

  if (!cfg.host || !cfg.user || !cfg.pass) {
    logger.warn(
      "SMTP not configured (missing host/user/pass) — skipping verify; email channel will be disabled at runtime"
    );
    return 0;
  }

  const transport = createSmtpTransport();
  if (!transport) {
    logger.warn("createSmtpTransport returned null despite config values — skipping verify");
    return 0;
  }

  try {
    await transport.verify();
    logger.info("SMTP preflight OK", { host: cfg.host, port: cfg.port, user: cfg.user });
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = diagnoseSmtpError(err, cfg);
    logger.error("SMTP preflight failed", { host: cfg.host, user: cfg.user, error: message });
    if (hint) {
      console.error(`::error::SMTP preflight failed — ${hint}`);
    } else {
      console.error(`::error::SMTP preflight failed — ${message}`);
    }
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error("verify_smtp crashed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });

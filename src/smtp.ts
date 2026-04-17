import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
}

export function resolveSmtpConfig(): SmtpConfig {
  return {
    host: (process.env.EMAIL_SMTP_HOST || process.env.SMTP_HOST || "").trim(),
    port: parseInt(
      (process.env.EMAIL_SMTP_PORT || process.env.SMTP_PORT || "587").trim(),
      10
    ),
    user: (process.env.EMAIL_SMTP_USER || process.env.SMTP_USER || "").trim(),
    pass: (process.env.EMAIL_SMTP_PASS || process.env.SMTP_PASS || "").trim(),
    from: (
      process.env.EMAIL_FROM ||
      process.env.EMAIL_SMTP_USER ||
      process.env.SMTP_USER ||
      ""
    ).trim(),
    to: (process.env.EMAIL_TO || "").trim(),
  };
}

export function createSmtpTransport(): nodemailer.Transporter | null {
  const cfg = resolveSmtpConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) return null;

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

/**
 * Produces a human-readable, actionable hint for common SMTP auth failures.
 * Returns `null` when the error is not recognized.
 */
export function diagnoseSmtpError(err: unknown, cfg: SmtpConfig | null = null): string | null {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const lower = message.toLowerCase();
  const host = (cfg?.host || "").toLowerCase();
  const user = (cfg?.user || "").toLowerCase();
  const looksLikeGmail =
    host.includes("gmail") || host.includes("smtp.googlemail") || user.endsWith("@gmail.com");

  if (lower.includes("webloginrequired") || lower.includes("5.7.9")) {
    return (
      "Gmail rejected the login (534-5.7.9 WebLoginRequired). This almost always means " +
      "SMTP_PASS is not a Google App Password. Enable 2-Step Verification on the sending account, " +
      "generate an App Password at https://myaccount.google.com/apppasswords (choose 'Mail' → " +
      "'Other'), and replace SMTP_PASS / EMAIL_SMTP_PASS with the 16-character value (no spaces). " +
      "Also confirm SMTP_USER matches the account that owns the App Password."
    );
  }

  if (
    lower.includes("5.7.8") ||
    lower.includes("username and password not accepted") ||
    lower.includes("invalid login") ||
    lower.includes("authentication failed") ||
    lower.includes("535")
  ) {
    if (looksLikeGmail) {
      return (
        "Gmail rejected the credentials (535 / 5.7.8). Gmail requires an App Password — your " +
        "regular account password will always fail. Enable 2-Step Verification and create an App " +
        "Password at https://myaccount.google.com/apppasswords, then set SMTP_PASS to that value."
      );
    }
    return (
      "SMTP server rejected the username/password. Double-check SMTP_USER / SMTP_PASS, and if " +
      "your provider requires an app-specific password (Gmail, Yahoo, iCloud, Fastmail), generate " +
      "one and use it instead of the account password."
    );
  }

  if (lower.includes("etimedout") || lower.includes("econnrefused") || lower.includes("enotfound")) {
    return (
      "Could not reach the SMTP server. Verify SMTP_HOST / SMTP_PORT (usually 587 for STARTTLS or " +
      "465 for SSL) and that the runner can reach the internet."
    );
  }

  return null;
}

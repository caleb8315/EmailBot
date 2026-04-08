import nodemailer from "nodemailer";

export function createSmtpTransport(): nodemailer.Transporter | null {
  const host = (process.env.EMAIL_SMTP_HOST ?? process.env.SMTP_HOST)?.trim();
  const port = parseInt(
    (process.env.EMAIL_SMTP_PORT ?? process.env.SMTP_PORT ?? "587").trim(),
    10
  );
  const user = (process.env.EMAIL_SMTP_USER ?? process.env.SMTP_USER)?.trim();
  const pass = (process.env.EMAIL_SMTP_PASS ?? process.env.SMTP_PASS)?.trim();

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

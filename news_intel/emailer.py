"""
Email delivery module.

Sends the daily briefing as an HTML email with plain-text fallback.
Reads credentials from environment variables:
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_TO
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)


def _get_env(key: str) -> str:
    val = os.environ.get(key, "").strip()
    if not val:
        raise ValueError(f"Missing required env var: {key}")
    return val


def send_briefing(
    html_content: str,
    text_content: str,
    recipient_override: Optional[str] = None,
) -> bool:
    """
    Send the daily briefing email (HTML + plain-text fallback).

    Returns:
        True on success, False on failure
    """
    try:
        host = _get_env("SMTP_HOST")
        port = int(_get_env("SMTP_PORT"))
        user = _get_env("SMTP_USER")
        password = _get_env("SMTP_PASS")
        to_addr = recipient_override or _get_env("EMAIL_TO")
    except ValueError as exc:
        logger.error("Email config incomplete: %s", exc)
        return False

    date_str = datetime.now(timezone.utc).strftime("%A, %B %d, %Y")
    subject = f"🌐 Daily Intelligence Briefing — {date_str}"

    msg = MIMEMultipart("alternative")
    msg["From"] = f"News Intel <{user}>"
    msg["To"] = to_addr
    msg["Subject"] = subject

    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        logger.info("Connecting to %s:%d …", host, port)
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(user, password)
            server.sendmail(user, [to_addr], msg.as_string())
        logger.info("Briefing emailed to %s", to_addr)
        return True

    except smtplib.SMTPAuthenticationError:
        logger.error(
            "SMTP authentication failed. If using Gmail with 2-Step Verification, "
            "generate an App Password at https://myaccount.google.com/apppasswords "
            "and set SMTP_PASS to that 16-character code."
        )
        return False
    except Exception as exc:
        logger.error("Failed to send email: %s", exc)
        return False

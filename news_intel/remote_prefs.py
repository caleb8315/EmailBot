"""
Fetch briefing_overlay from Supabase REST (same row the Telegram bot updates).

Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and TELEGRAM_CHAT_ID (used as user_id).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict

import requests

logger = logging.getLogger(__name__)


def fetch_briefing_overlay() -> Dict[str, Any]:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    user_id = os.environ.get("TELEGRAM_CHAT_ID") or os.environ.get("DEFAULT_USER_ID") or "default"

    if not url or not key:
        return {}

    try:
        r = requests.get(
            f"{url}/rest/v1/user_preferences",
            params={
                "user_id": f"eq.{user_id}",
                "select": "briefing_overlay",
            },
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
            timeout=12,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return {}
        overlay = rows[0].get("briefing_overlay") or {}
        return overlay if isinstance(overlay, dict) else {}
    except Exception as exc:
        logger.debug("fetch_briefing_overlay skipped: %s", exc)
        return {}

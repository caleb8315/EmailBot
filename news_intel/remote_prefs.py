"""
Fetch briefing_overlay from Supabase REST (same row the Telegram bot updates).

Uses the same identity resolution chain as src/user_identity.ts:
  PREFERENCE_USER_ID > TELEGRAM_CHAT_ID > DEFAULT_USER_ID > "default"
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict

import requests

logger = logging.getLogger(__name__)


def resolve_preference_user_id() -> str:
    """Mirror the TS resolvePreferenceUserId() priority chain."""
    for var in ("PREFERENCE_USER_ID", "TELEGRAM_CHAT_ID", "DEFAULT_USER_ID"):
        val = (os.environ.get(var) or "").strip()
        if val:
            return val
    return "default"


def fetch_briefing_overlay() -> Dict[str, Any]:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    user_id = resolve_preference_user_id()

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

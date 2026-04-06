"""
Market sentiment tracker.

Tracks daily sentiment for finance-related categories (Economy, Stocks, Crypto).
Stores history in data/sentiment.csv and generates trend indicators.

Sentiment is extracted from the existing OpenAI batch call (no extra API cost).
"""

from __future__ import annotations

import csv
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
SENTIMENT_PATH = DATA_DIR / "sentiment.csv"

TRACKED_CATEGORIES = ["Economy & Markets", "Stocks", "Crypto"]

MOOD_LABELS = {
    (-5, -3): ("Very Bearish", "🔴📉"),
    (-3, -1): ("Bearish", "🟠📉"),
    (-1, 1): ("Neutral", "⚪➡️"),
    (1, 3): ("Bullish", "🟢📈"),
    (3, 6): ("Very Bullish", "🟢🚀"),
}


def _mood_label(score: float) -> Tuple[str, str]:
    for (low, high), (label, icon) in MOOD_LABELS.items():
        if low <= score < high:
            return label, icon
    return "Neutral", "⚪➡️"


def load_history(days: int = 14) -> List[Dict]:
    """Load sentiment history from CSV."""
    if not SENTIMENT_PATH.exists():
        return []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = []
    try:
        with open(SENTIMENT_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("date", "") >= cutoff:
                    rows.append(row)
    except Exception as exc:
        logger.warning("Could not read sentiment history: %s", exc)
    return rows


def save_today(scores: Dict[str, float], notes: Dict[str, str]) -> None:
    """Append today's sentiment scores to CSV."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    DATA_DIR.mkdir(exist_ok=True)

    file_exists = SENTIMENT_PATH.exists() and SENTIMENT_PATH.stat().st_size > 0
    try:
        with open(SENTIMENT_PATH, "a", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(["date", "category", "score", "trend_note"])
            for cat in TRACKED_CATEGORIES:
                if cat in scores:
                    writer.writerow([today, cat, f"{scores[cat]:.1f}", notes.get(cat, "")])
        logger.info("Saved sentiment for %d categories", len(scores))
    except Exception as exc:
        logger.error("Failed to save sentiment: %s", exc)


def get_trend(category: str, current_score: float, history: List[Dict]) -> str:
    """Compare today's score to recent history and return a trend arrow."""
    cat_history = [r for r in history if r.get("category") == category]
    if not cat_history:
        return "NEW"

    recent_scores = []
    for r in cat_history[-3:]:
        try:
            recent_scores.append(float(r["score"]))
        except (ValueError, KeyError):
            continue

    if not recent_scores:
        return "NEW"

    avg = sum(recent_scores) / len(recent_scores)
    delta = current_score - avg

    if delta > 1.0:
        return "↑ Improving"
    elif delta < -1.0:
        return "↓ Declining"
    else:
        return "→ Stable"


def format_sentiment_section(scores: Dict[str, float], notes: Dict[str, str]) -> str:
    """Generate the market mood summary for the briefing."""
    history = load_history()
    lines = []
    for cat in TRACKED_CATEGORIES:
        score = scores.get(cat)
        if score is None:
            continue
        label, icon = _mood_label(score)
        trend = get_trend(cat, score, history)
        note = notes.get(cat, "")
        cat_short = cat.replace("Economy & Markets", "Economy").replace("Conspiracy / Unverified Signals", "Alt")
        lines.append(f"• {icon} {cat_short}: {label} ({score:+.1f}) — {trend}")
        if note:
            lines.append(f"  {note}")
    return "\n".join(lines) if lines else ""

"""
Topic threading across days.

Tracks stories across multiple briefings so the email can show:
  - "Day X of coverage" for ongoing stories
  - "NEW" for stories appearing for the first time
  - Trajectory: Escalating / Stable / De-escalating

Uses fuzzy matching on headlines + entity overlap to link today's
clusters to historical threads stored in data/threads.json.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from rapidfuzz import fuzz

from news_intel.verifier import StoryCluster

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
THREADS_PATH = DATA_DIR / "threads.json"

TITLE_MATCH_THRESHOLD = 50
MAX_THREAD_AGE_DAYS = 14
MAX_THREADS = 500


def _load_threads() -> Dict[str, dict]:
    """Load thread history from JSON."""
    if not THREADS_PATH.exists():
        return {}
    try:
        data = json.loads(THREADS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("Could not load threads: %s", exc)
        return {}


def _save_threads(threads: Dict[str, dict]) -> None:
    """Save thread history to JSON, pruning old entries."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=MAX_THREAD_AGE_DAYS)).strftime("%Y-%m-%d")

    pruned = {}
    for tid, thread in threads.items():
        appearances = [a for a in thread.get("appearances", []) if a.get("date", "") >= cutoff]
        if appearances:
            thread["appearances"] = appearances
            pruned[tid] = thread

    if len(pruned) > MAX_THREADS:
        sorted_threads = sorted(pruned.items(), key=lambda t: t[1]["appearances"][-1]["date"], reverse=True)
        pruned = dict(sorted_threads[:MAX_THREADS])

    DATA_DIR.mkdir(exist_ok=True)
    THREADS_PATH.write_text(json.dumps(pruned, indent=2), encoding="utf-8")
    logger.info("Saved %d active threads (pruned from %d)", len(pruned), len(threads))


def _make_thread_id(headline: str) -> str:
    """Create a simple thread ID from headline keywords."""
    import hashlib
    normalized = " ".join(headline.lower().split()[:8])
    return hashlib.md5(normalized.encode()).hexdigest()[:12]


def _find_matching_thread(
    cluster: StoryCluster,
    threads: Dict[str, dict],
) -> Optional[str]:
    """Find an existing thread that matches this cluster."""
    for tid, thread in threads.items():
        thread_headline = thread.get("headline", "")
        sim = fuzz.token_sort_ratio(cluster.headline.lower(), thread_headline.lower())
        if sim >= TITLE_MATCH_THRESHOLD:
            return tid

        for appearance in thread.get("appearances", [])[-3:]:
            prev_headline = appearance.get("headline", "")
            if fuzz.token_sort_ratio(cluster.headline.lower(), prev_headline.lower()) >= TITLE_MATCH_THRESHOLD:
                return tid

    return None


def _compute_trajectory(appearances: List[dict]) -> str:
    """Determine if a story is escalating, stable, or de-escalating."""
    if len(appearances) < 2:
        return "NEW"

    recent_sources = [a.get("source_count", 1) for a in appearances[-3:]]
    if len(recent_sources) >= 2:
        trend = recent_sources[-1] - recent_sources[0]
        if trend > 1:
            return "🔺 Escalating"
        elif trend < -1:
            return "🔻 De-escalating"
    return "➡️ Ongoing"


def thread_clusters(clusters: List[StoryCluster]) -> List[StoryCluster]:
    """
    Match today's clusters against historical threads and annotate each with:
      - cluster.thread_days: number of days this story has been tracked
      - cluster.thread_trajectory: Escalating / Ongoing / De-escalating / NEW
      - cluster.thread_label: human-readable label like "Day 3 · Escalating"
    """
    threads = _load_threads()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for cluster in clusters:
        tid = _find_matching_thread(cluster, threads)

        if tid:
            thread = threads[tid]
            already_today = any(a["date"] == today for a in thread["appearances"])
            if not already_today:
                thread["appearances"].append({
                    "date": today,
                    "headline": cluster.headline,
                    "label": cluster.label,
                    "source_count": cluster.distinct_publishers,
                    "category": cluster.category,
                })
            thread["headline"] = cluster.headline

            days = len({a["date"] for a in thread["appearances"]})
            trajectory = _compute_trajectory(thread["appearances"])
            cluster.thread_days = days  # type: ignore[attr-defined]
            cluster.thread_trajectory = trajectory  # type: ignore[attr-defined]
            cluster.thread_label = f"Day {days} · {trajectory}"  # type: ignore[attr-defined]

        else:
            tid = _make_thread_id(cluster.headline)
            threads[tid] = {
                "headline": cluster.headline,
                "category": cluster.category,
                "appearances": [{
                    "date": today,
                    "headline": cluster.headline,
                    "label": cluster.label,
                    "source_count": cluster.distinct_publishers,
                    "category": cluster.category,
                }],
            }
            cluster.thread_days = 1  # type: ignore[attr-defined]
            cluster.thread_trajectory = "NEW"  # type: ignore[attr-defined]
            cluster.thread_label = "🆕 NEW"  # type: ignore[attr-defined]

    new_count = sum(1 for c in clusters if getattr(c, "thread_trajectory", "") == "NEW")
    ongoing_count = len(clusters) - new_count
    logger.info("Threading: %d new stories, %d ongoing threads", new_count, ongoing_count)

    _save_threads(threads)
    return clusters

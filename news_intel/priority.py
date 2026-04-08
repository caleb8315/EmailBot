"""
Personalized priority scoring.

Reads user preferences from data/preferences.json and uses them to
re-rank story clusters so the categories you care about most get
placed first and get more slots.

Also merges optional overlays from:
  - data/user_preferences.json (local file, e.g. self-hosted bot)
  - Supabase briefing_overlay (same JSON the Telegram bot updates), when env is set

Scoring formula per cluster:
  score = (user_weight / 10) * importance_factor

Where importance_factor = verification_multiplier * source_count_bonus
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from news_intel.config import SECTION_ORDER
from news_intel.remote_prefs import fetch_briefing_overlay
from news_intel.verifier import StoryCluster

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
PREFS_PATH = DATA_DIR / "preferences.json"
USER_PREFS_PATH = DATA_DIR / "user_preferences.json"

VERIFICATION_MULTIPLIER = {
    "🟢 VERIFIED": 3.0,
    "🟡 DEVELOPING": 2.0,
    "🔴 UNVERIFIED": 1.0,
}


def _apply_briefing_overlay(prefs: Dict[str, float], oc: Dict[str, Any]) -> None:
    if not oc:
        return
    for cat, weight in oc.get("category_weights", {}).items():
        if cat in prefs:
            prefs[cat] = float(weight)
    for cat in oc.get("boost_categories", []):
        if cat in prefs:
            prefs[cat] = min(prefs[cat] + 2, 10.0)
    for cat in oc.get("ignore_categories", []):
        if cat in prefs:
            prefs[cat] = 1.0


def load_preferences() -> Dict[str, float]:
    """
    Load user category weights from preferences.json, then apply any
    briefing overlays (local file + Supabase).
    """
    prefs: Dict[str, float] = {cat: 5.0 for cat in SECTION_ORDER}

    try:
        raw = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
        loaded = {k: float(v) for k, v in raw.items() if not k.startswith("_")}
        prefs.update(loaded)
        logger.info("Loaded base preferences from %s", PREFS_PATH.name)
    except Exception as exc:
        logger.debug("Base preferences fallback: %s", exc)

    overlays: List[Dict[str, Any]] = []

    if USER_PREFS_PATH.exists():
        try:
            overlays.append(
                json.loads(USER_PREFS_PATH.read_text(encoding="utf-8"))
            )
            logger.info("Queued local overlay: %s", USER_PREFS_PATH.name)
        except Exception as exc:
            logger.debug("Skipped local user_preferences.json: %s", exc)

    remote = fetch_briefing_overlay()
    if remote:
        overlays.append(remote)
        logger.info("Applied remote briefing_overlay from Supabase")

    for oc in overlays:
        _apply_briefing_overlay(prefs, oc)

    return prefs


def score_cluster(cluster: StoryCluster, prefs: Dict[str, float]) -> float:
    """Compute a priority score for a single cluster."""
    user_weight = prefs.get(cluster.category, 5.0) / 10.0
    verification_mult = VERIFICATION_MULTIPLIER.get(cluster.label, 1.0)
    source_bonus = min(cluster.distinct_publishers / 3.0, 2.0)
    return user_weight * verification_mult * source_bonus


def prioritize(clusters: List[StoryCluster]) -> List[StoryCluster]:
    """
    Re-rank clusters within each section by priority score.
    Higher-preference categories get their best stories surfaced first.
    Also reorders sections so your highest-weighted categories come first.
    """
    prefs = load_preferences()

    for cluster in clusters:
        cluster._priority_score = score_cluster(cluster, prefs)  # type: ignore[attr-defined]

    section_weight = {cat: prefs.get(cat, 5.0) for cat in SECTION_ORDER}
    custom_order = sorted(
        SECTION_ORDER, key=lambda c: section_weight.get(c, 5.0), reverse=True
    )

    by_section: Dict[str, List[StoryCluster]] = {cat: [] for cat in custom_order}
    for c in clusters:
        if c.category in by_section:
            by_section[c.category].append(c)

    result: List[StoryCluster] = []
    for cat in custom_order:
        cat_clusters = by_section.get(cat, [])
        cat_clusters.sort(
            key=lambda c: c._priority_score, reverse=True  # type: ignore[attr-defined]
        )
        result.extend(cat_clusters)

    logger.info(
        "Prioritized %d clusters. Top categories: %s",
        len(result),
        ", ".join(custom_order[:3]),
    )
    return result

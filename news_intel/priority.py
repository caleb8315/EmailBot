"""
Personalized priority scoring.

Reads user preferences from data/preferences.json and uses them to
re-rank story clusters so the categories you care about most get
placed first and get more slots.

Scoring formula per cluster:
  score = (user_weight / 10) * importance_factor

Where importance_factor = verification_multiplier * source_count_bonus
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List

from news_intel.config import SECTION_ORDER
from news_intel.verifier import StoryCluster

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
PREFS_PATH = DATA_DIR / "preferences.json"

VERIFICATION_MULTIPLIER = {
    "🟢 VERIFIED": 3.0,
    "🟡 DEVELOPING": 2.0,
    "🔴 UNVERIFIED": 1.0,
}


OPENCLAW_PREFS_PATH = DATA_DIR / "user_preferences.json"


def load_preferences() -> Dict[str, float]:
    """
    Load user category weights. Checks for an OpenClaw-managed
    user_preferences.json first (if it exists), then falls back to the
    standard preferences.json, then hardcoded defaults.
    """
    prefs: Dict[str, float] = {cat: 5.0 for cat in SECTION_ORDER}

    for path in (PREFS_PATH, ):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            loaded = {k: float(v) for k, v in raw.items() if not k.startswith("_")}
            prefs.update(loaded)
            logger.info("Loaded preferences from %s: %s", path.name, {k: v for k, v in loaded.items()})
            break
        except Exception:
            continue

    if OPENCLAW_PREFS_PATH.exists():
        try:
            oc = json.loads(OPENCLAW_PREFS_PATH.read_text(encoding="utf-8"))
            for cat, weight in oc.get("category_weights", {}).items():
                if cat in prefs:
                    prefs[cat] = float(weight)
            for cat in oc.get("boost_categories", []):
                if cat in prefs:
                    prefs[cat] = min(prefs[cat] + 2, 10.0)
            for cat in oc.get("ignore_categories", []):
                if cat in prefs:
                    prefs[cat] = 1.0
            logger.info("Applied OpenClaw preference overrides from %s", OPENCLAW_PREFS_PATH.name)
        except Exception as exc:
            logger.debug("No OpenClaw prefs applied: %s", exc)

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
    custom_order = sorted(SECTION_ORDER, key=lambda c: section_weight.get(c, 5.0), reverse=True)

    by_section: Dict[str, List[StoryCluster]] = {cat: [] for cat in custom_order}
    for c in clusters:
        if c.category in by_section:
            by_section[c.category].append(c)

    result: List[StoryCluster] = []
    for cat in custom_order:
        cat_clusters = by_section.get(cat, [])
        cat_clusters.sort(key=lambda c: c._priority_score, reverse=True)  # type: ignore[attr-defined]
        result.extend(cat_clusters)

    logger.info(
        "Prioritized %d clusters. Top categories: %s",
        len(result),
        ", ".join(custom_order[:3]),
    )
    return result

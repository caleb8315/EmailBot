#!/usr/bin/env python3
"""
Preference updater for OpenClaw memory integration.

Reads OpenClaw memory exports (user_preferences.json) and syncs them
into the pipeline's data/preferences.json, updating category weights,
ignore lists, and tier-1 keyword overrides.

Can also be called directly with --set flags for CLI-based updates.

Usage:
  # Sync from OpenClaw memory export
  python preferences_updater.py --from-openclaw /path/to/user_preferences.json

  # Direct CLI updates
  python preferences_updater.py --boost "AI & Technology" --ignore "Crypto"
  python preferences_updater.py --add-keyword "tariff" --remove-keyword "bitcoin"
  python preferences_updater.py --set-weight "Stocks=10"
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
PIPELINE_PREFS = DATA_DIR / "preferences.json"

DEFAULT_PREFS: Dict[str, Any] = {
    "_comment": "Edit these weights to prioritize categories you care about most. Higher = more prominent in your briefing. Scale: 1-10.",
    "World & Geopolitics": 6,
    "Wars & Conflicts": 9,
    "Economy & Markets": 8,
    "Stocks": 9,
    "Crypto": 7,
    "AI & Technology": 8,
    "Power & Elite Activity": 6,
    "Conspiracy / Unverified Signals": 5,
}

OPENCLAW_PREFS_TEMPLATE: Dict[str, Any] = {
    "ignore_categories": [],
    "boost_categories": [],
    "ignore_sources": [],
    "tier1_keywords": [],
    "category_weights": {},
    "last_briefing_feedback": "",
    "updated_at": "",
}


def load_pipeline_prefs() -> Dict[str, Any]:
    """Load current pipeline preferences."""
    try:
        return json.loads(PIPELINE_PREFS.read_text(encoding="utf-8"))
    except Exception:
        logger.info("No existing preferences found, using defaults")
        return deepcopy(DEFAULT_PREFS)


def save_pipeline_prefs(prefs: Dict[str, Any]) -> None:
    """Write preferences back to pipeline file."""
    DATA_DIR.mkdir(exist_ok=True)
    PIPELINE_PREFS.write_text(json.dumps(prefs, indent=4) + "\n", encoding="utf-8")
    logger.info("Saved pipeline preferences to %s", PIPELINE_PREFS)


def load_openclaw_prefs(path: str) -> Dict[str, Any]:
    """Load the OpenClaw-managed user_preferences.json."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error("Failed to load OpenClaw prefs from %s: %s", path, exc)
        return {}


def create_openclaw_prefs_template(path: str) -> None:
    """Create a blank OpenClaw preferences file if it doesn't exist."""
    p = Path(path)
    if p.exists():
        logger.info("OpenClaw prefs already exist at %s", path)
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    template = deepcopy(OPENCLAW_PREFS_TEMPLATE)
    template["updated_at"] = datetime.now(timezone.utc).isoformat()
    p.write_text(json.dumps(template, indent=2) + "\n", encoding="utf-8")
    logger.info("Created OpenClaw prefs template at %s", path)


def sync_from_openclaw(openclaw_path: str) -> Dict[str, Any]:
    """
    Merge OpenClaw memory-managed preferences into pipeline preferences.

    Strategy:
    - boost_categories: increase weight by +2 (capped at 10)
    - ignore_categories: decrease weight to 1
    - category_weights: direct overrides (takes precedence)
    - tier1_keywords / ignore_sources: stored in a separate section
    """
    oc = load_openclaw_prefs(openclaw_path)
    if not oc:
        return load_pipeline_prefs()

    prefs = load_pipeline_prefs()

    for cat in oc.get("ignore_categories", []):
        if cat in prefs and not cat.startswith("_"):
            prefs[cat] = 1
            logger.info("Suppressed category: %s → weight 1", cat)

    for cat in oc.get("boost_categories", []):
        if cat in prefs and not cat.startswith("_"):
            prefs[cat] = min(prefs[cat] + 2, 10)
            logger.info("Boosted category: %s → weight %s", cat, prefs[cat])

    for cat, weight in oc.get("category_weights", {}).items():
        if cat in prefs and not cat.startswith("_"):
            prefs[cat] = max(1, min(10, int(weight)))
            logger.info("Set category weight: %s = %s", cat, prefs[cat])

    prefs["_openclaw_tier1_keywords"] = oc.get("tier1_keywords", [])
    prefs["_openclaw_ignore_sources"] = oc.get("ignore_sources", [])
    prefs["_openclaw_synced_at"] = datetime.now(timezone.utc).isoformat()

    save_pipeline_prefs(prefs)
    return prefs


def apply_feedback(feedback: str, prefs_path: Optional[str] = None) -> Dict[str, str]:
    """
    Parse natural-language feedback and return structured preference changes.
    This is a rule-based parser — no LLM needed for common patterns.

    Returns a dict of changes made, e.g. {"Crypto": "ignored", "AI & Technology": "boosted"}.
    """
    from news_intel.config import SECTION_ORDER

    changes: Dict[str, str] = {}
    prefs = load_pipeline_prefs()
    lower = feedback.lower()

    category_aliases = {
        "crypto": "Crypto",
        "bitcoin": "Crypto",
        "ai": "AI & Technology",
        "tech": "AI & Technology",
        "technology": "AI & Technology",
        "stocks": "Stocks",
        "stock market": "Stocks",
        "markets": "Economy & Markets",
        "economy": "Economy & Markets",
        "econ": "Economy & Markets",
        "world": "World & Geopolitics",
        "geopolitics": "World & Geopolitics",
        "war": "Wars & Conflicts",
        "wars": "Wars & Conflicts",
        "conflicts": "Wars & Conflicts",
        "power": "Power & Elite Activity",
        "politics": "Power & Elite Activity",
        "conspiracy": "Conspiracy / Unverified Signals",
        "alt": "Conspiracy / Unverified Signals",
    }

    skip_phrases = ["skip", "less", "don't care about", "remove", "hide", "no more", "stop showing"]
    more_phrases = ["more", "I care about", "boost", "prioritize", "focus on", "interested in"]

    for alias, full_cat in category_aliases.items():
        for phrase in skip_phrases:
            if phrase in lower and alias in lower:
                if full_cat in prefs and not full_cat.startswith("_"):
                    prefs[full_cat] = max(1, prefs[full_cat] - 3)
                    changes[full_cat] = f"reduced to {prefs[full_cat]}"
                break

        for phrase in more_phrases:
            if phrase in lower and alias in lower:
                if full_cat in prefs and not full_cat.startswith("_"):
                    prefs[full_cat] = min(10, prefs[full_cat] + 2)
                    changes[full_cat] = f"boosted to {prefs[full_cat]}"
                break

    if changes:
        save_pipeline_prefs(prefs)

    return changes


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    parser = argparse.ArgumentParser(description="Update news pipeline preferences")
    parser.add_argument(
        "--from-openclaw", type=str,
        help="Sync preferences from an OpenClaw memory export file",
    )
    parser.add_argument(
        "--create-template", type=str,
        help="Create a blank OpenClaw preferences template at the given path",
    )
    parser.add_argument(
        "--feedback", type=str,
        help="Natural-language feedback to parse (e.g., 'less crypto, more AI')",
    )
    parser.add_argument(
        "--boost", type=str, action="append", default=[],
        help="Category name to boost (can repeat)",
    )
    parser.add_argument(
        "--ignore", type=str, action="append", default=[],
        help="Category name to suppress (can repeat)",
    )
    parser.add_argument(
        "--set-weight", type=str, action="append", default=[],
        help="Set category weight directly, e.g. 'Stocks=10'",
    )
    parser.add_argument(
        "--add-keyword", type=str, action="append", default=[],
        help="Add a tier-1 breaking keyword",
    )
    parser.add_argument(
        "--show", action="store_true",
        help="Print current preferences and exit",
    )
    args = parser.parse_args()

    if args.show:
        prefs = load_pipeline_prefs()
        print(json.dumps(prefs, indent=2))
        return

    if args.create_template:
        create_openclaw_prefs_template(args.create_template)
        return

    if args.from_openclaw:
        result = sync_from_openclaw(args.from_openclaw)
        print(json.dumps(result, indent=2))
        return

    if args.feedback:
        changes = apply_feedback(args.feedback)
        if changes:
            print(json.dumps({"status": "updated", "changes": changes}, indent=2))
        else:
            print(json.dumps({"status": "no_changes", "reason": "No actionable preference signals found"}, indent=2))
        return

    prefs = load_pipeline_prefs()

    for cat in args.boost:
        if cat in prefs and not cat.startswith("_"):
            prefs[cat] = min(10, prefs.get(cat, 5) + 2)

    for cat in args.ignore:
        if cat in prefs and not cat.startswith("_"):
            prefs[cat] = 1

    for pair in args.set_weight:
        if "=" in pair:
            cat, val = pair.rsplit("=", 1)
            if cat.strip() in prefs:
                prefs[cat.strip()] = max(1, min(10, int(val)))

    for kw in args.add_keyword:
        existing = prefs.get("_openclaw_tier1_keywords", [])
        if kw.lower() not in [k.lower() for k in existing]:
            existing.append(kw.lower())
            prefs["_openclaw_tier1_keywords"] = existing

    save_pipeline_prefs(prefs)
    print(json.dumps(prefs, indent=2))


if __name__ == "__main__":
    main()

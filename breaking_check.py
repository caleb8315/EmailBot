#!/usr/bin/env python3
"""
Lightweight breaking-news checker (cron / heartbeat).

Fetches RSS feeds, filters to last 2 hours, scores stories by cross-source
corroboration and tier-1 keyword matching. Exits fast (< 30s target) with
no AI calls unless a genuine breaking threshold is met.

Merges tier1_keywords / ignore_categories from:
  --preferences-file, data/user_preferences.json, and Supabase briefing_overlay (if env set).

Output: JSON to stdout
  { "has_breaking": bool, "stories": [...], "checked_at": "...", "activation_count": N }

Usage:
  python breaking_check.py
  python breaking_check.py --threshold 3
  python breaking_check.py --preferences-file data/user_preferences.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from dotenv import load_dotenv

load_dotenv()

from news_intel.config import SOURCES, Source
from news_intel.rss_fetcher import fetch_all, RawArticle
from news_intel.remote_prefs import fetch_briefing_overlay
from news_intel.llm_client import (
    create_openai_client,
    get_model_for_workload,
    call_with_retry,
    has_llm_credentials,
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"


def _dedupe_str_list(items: List[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for x in items:
        k = x.strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(x.strip().lower())
    return out


def _load_merged_overlay(cli_prefs_path: Optional[str]) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    paths: List[Path] = []
    if cli_prefs_path:
        paths.append(Path(cli_prefs_path))
    default_fp = DATA_DIR / "user_preferences.json"
    if default_fp.exists() and default_fp not in paths:
        paths.append(default_fp)

    for p in paths:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            for key in (
                "tier1_keywords",
                "ignore_categories",
                "ignore_sources",
            ):
                if key in data and data[key]:
                    merged[key] = merged.get(key, []) + list(data[key])
        except Exception as exc:
            logger.warning("Could not read %s: %s", p, exc)

    remote = fetch_briefing_overlay()
    for key in ("tier1_keywords", "ignore_categories", "ignore_sources"):
        if remote.get(key):
            merged[key] = merged.get(key, []) + list(remote[key])

    pref_json = DATA_DIR / "preferences.json"
    if pref_json.exists():
        try:
            p = json.loads(pref_json.read_text(encoding="utf-8"))
            legacy = p.get("_bot_tier1_keywords") or p.get(
                "_openclaw_tier1_keywords", []
            )
            if legacy:
                merged["tier1_keywords"] = merged.get("tier1_keywords", []) + list(
                    legacy
                )
        except Exception:
            pass

    if merged.get("tier1_keywords"):
        merged["tier1_keywords"] = _dedupe_str_list(merged["tier1_keywords"])
    if merged.get("ignore_categories"):
        merged["ignore_categories"] = _dedupe_str_list(
            [str(x) for x in merged["ignore_categories"]]
        )
    return merged

ACTIVATION_FILE = Path("/tmp/news_intel_daily_activations.txt")
MAX_ACTIVATIONS_PER_DAY = 5
RECENCY_HOURS = 2
DEFAULT_SOURCE_THRESHOLD = 3

TIER1_KEYWORDS = [
    "war", "invasion", "attack", "missile", "nuclear", "coup",
    "crash", "recession", "default", "collapse", "bank run",
    "election", "impeach", "assassination", "martial law",
    "fed rate", "federal reserve", "interest rate", "rate cut", "rate hike",
    "earthquake", "tsunami", "hurricane", "wildfire", "pandemic",
    "apple", "google", "microsoft", "nvidia", "openai", "meta",
    "sanctions", "tariff", "embargo", "ceasefire", "peace deal",
    "ai regulation", "executive order", "supreme court",
    "bitcoin", "crypto crash", "sec",
]


def _check_activation_limit() -> int:
    """
    Read and increment the daily activation counter.
    Returns the current count AFTER incrementing.
    Resets at midnight UTC.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    count = 0
    stored_date = ""
    if ACTIVATION_FILE.exists():
        try:
            data = json.loads(ACTIVATION_FILE.read_text())
            stored_date = data.get("date", "")
            count = data.get("count", 0)
        except (json.JSONDecodeError, KeyError):
            pass

    if stored_date != today:
        count = 0

    count += 1
    ACTIVATION_FILE.write_text(json.dumps({"date": today, "count": count}))
    return count


def _matches_tier1(title: str, extra_keywords: List[str] | None = None) -> bool:
    """Check if a title matches any tier-1 breaking keyword."""
    lower = title.lower()
    keywords = TIER1_KEYWORDS + (extra_keywords or [])
    return any(kw in lower for kw in keywords)


def _cluster_by_event(
    articles: List[RawArticle],
) -> Dict[str, List[RawArticle]]:
    """
    Lightweight clustering by fuzzy title similarity.
    Uses a simplified token-overlap approach (no rapidfuzz import
    to stay fast — we only need rough grouping here).
    """
    from rapidfuzz import fuzz

    clusters: Dict[int, List[RawArticle]] = {}
    article_cluster: Dict[int, int] = {}
    next_id = 0

    for i, article in enumerate(articles):
        matched = False
        for j in range(i):
            if fuzz.token_sort_ratio(
                article.title.lower(), articles[j].title.lower()
            ) >= 50:
                cid = article_cluster[j]
                clusters[cid].append(article)
                article_cluster[i] = cid
                matched = True
                break
        if not matched:
            clusters[next_id] = [article]
            article_cluster[i] = next_id
            next_id += 1

    named: Dict[str, List[RawArticle]] = {}
    for cid, group in clusters.items():
        best = sorted(group, key=lambda a: (a.source.tier, -(a.published or datetime.min.replace(tzinfo=timezone.utc)).timestamp()))[0]
        named[best.title] = group
    return named


def _summarize_breaking(stories: List[dict]) -> List[dict]:
    """
    Call the configured LLM only for confirmed breaking stories.
    Skips if no API key is set.
    """
    if not has_llm_credentials():
        return stories

    headlines = [s["headline"] for s in stories[:5]]
    prompt = (
        "You are a wire-service editor. For each headline below, write exactly "
        "one sentence explaining why it matters. Be factual, no hype.\n\n"
        + "\n".join(f"{i+1}. {h}" for i, h in enumerate(headlines))
        + "\n\nReturn a JSON array of strings, one per headline. No markdown."
    )

    try:
        client = create_openai_client()
        if client is None:
            return stories
        model = get_model_for_workload("pipeline")
        resp = call_with_retry(
            "breaking_summary",
            lambda: client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=500,
            ),
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        summaries = json.loads(raw)
        for i, s in enumerate(stories[:len(summaries)]):
            s["ai_summary"] = summaries[i]
    except Exception as exc:
        logger.warning("Breaking summary AI call failed (non-fatal): %s", exc)

    return stories


def run_breaking_check(
    source_threshold: int = DEFAULT_SOURCE_THRESHOLD,
    preferences_file: Optional[str] = None,
) -> dict:
    """
    Main breaking-check logic. Returns a JSON-serializable dict.
    """
    t0 = time.monotonic()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=RECENCY_HOURS)

    activation_count = _check_activation_limit()
    if activation_count > MAX_ACTIVATIONS_PER_DAY:
        return {
            "has_breaking": False,
            "stories": [],
            "reason": f"Daily activation limit reached ({activation_count}/{MAX_ACTIVATIONS_PER_DAY})",
            "checked_at": now.isoformat(),
            "activation_count": activation_count,
            "elapsed_seconds": round(time.monotonic() - t0, 1),
        }

    overlay = _load_merged_overlay(preferences_file)
    extra_keywords: List[str] = list(overlay.get("tier1_keywords", []))
    ignore_categories: List[str] = [
        str(x) for x in overlay.get("ignore_categories", [])
    ]

    raw_articles = fetch_all(SOURCES)

    recent = [
        a for a in raw_articles
        if a.published and a.published >= cutoff
    ]
    logger.info("Found %d articles in last %d hours", len(recent), RECENCY_HOURS)

    if ignore_categories:
        recent = [a for a in recent if a.source.category not in ignore_categories]

    if not recent:
        return {
            "has_breaking": False,
            "stories": [],
            "reason": "No recent articles found",
            "checked_at": now.isoformat(),
            "activation_count": activation_count,
            "elapsed_seconds": round(time.monotonic() - t0, 1),
        }

    clusters = _cluster_by_event(recent)

    breaking_stories: List[dict] = []
    for headline, group in clusters.items():
        distinct_pubs = len({a.source.name for a in group})
        tier1_match = _matches_tier1(headline, extra_keywords)
        credible_count = len({a.source.name for a in group if a.source.tier <= 2})

        is_breaking = (
            distinct_pubs >= source_threshold
            or (tier1_match and credible_count >= 2)
        )

        if is_breaking:
            sources = sorted({a.source.name for a in group})
            newest = max((a.published for a in group if a.published), default=now)
            breaking_stories.append({
                "headline": headline,
                "source_count": distinct_pubs,
                "credible_count": credible_count,
                "tier1_keyword_match": tier1_match,
                "sources": sources,
                "category": group[0].source.category,
                "published": newest.isoformat(),
            })

    breaking_stories.sort(
        key=lambda s: (s["credible_count"], s["source_count"]),
        reverse=True,
    )
    breaking_stories = breaking_stories[:5]

    if breaking_stories:
        breaking_stories = _summarize_breaking(breaking_stories)

    elapsed = round(time.monotonic() - t0, 1)
    return {
        "has_breaking": len(breaking_stories) > 0,
        "stories": breaking_stories,
        "total_recent_articles": len(recent),
        "clusters_checked": len(clusters),
        "checked_at": now.isoformat(),
        "activation_count": activation_count,
        "elapsed_seconds": elapsed,
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    parser = argparse.ArgumentParser(description="Breaking news checker")
    parser.add_argument(
        "--threshold", type=int, default=DEFAULT_SOURCE_THRESHOLD,
        help=f"Minimum distinct sources to flag as breaking (default: {DEFAULT_SOURCE_THRESHOLD})",
    )
    parser.add_argument(
        "--preferences-file", type=str, default=None,
        help="Path to user_preferences.json for extra keywords / ignore lists",
    )
    args = parser.parse_args()

    result = run_breaking_check(
        source_threshold=args.threshold,
        preferences_file=args.preferences_file,
    )

    print(json.dumps(result, indent=2))
    sys.exit(0 if not result["has_breaking"] else 0)


if __name__ == "__main__":
    main()

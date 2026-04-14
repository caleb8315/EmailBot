"""
Source registry for news intelligence pipeline.

Loads sources from the shared config/sources.json master registry
(single source of truth for both TypeScript and Python pipelines).

Each source has:
  - name: publisher display name
  - url: RSS feed URL
  - category: editorial section it maps to
  - tier: credibility tier (1=major wire/institutional, 2=established outlet, 3=independent/alternative)
  - lean: ideological lean tag for bias-awareness

Extended fields (all optional, with safe defaults):
  - reliability: float score 0.0-1.0 for source trustworthiness
  - signal_type: "breaking" | "analysis" | "narrative" | "data" | "general"
  - region: geographic focus
  - topics: tuple of topic tags for coverage tracking
  - update_frequency: "high" | "medium" | "low"
  - role: "signal" | "confirmation" | "analysis" | "contrarian"
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "sources.json"


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    category: str
    tier: int  # 1=wire/institutional, 2=established, 3=independent/alt
    lean: str
    reliability: float = 0.5
    signal_type: str = "general"
    region: str = "global"
    topics: Tuple[str, ...] = ()
    update_frequency: str = "medium"
    role: str = "signal"


# ---------------------------------------------------------------------------
# Category constants
# ---------------------------------------------------------------------------
CAT_WORLD = "World & Geopolitics"
CAT_WAR = "Wars & Conflicts"
CAT_ECON = "Economy & Markets"
CAT_STOCKS = "Stocks"
CAT_CRYPTO = "Crypto"
CAT_TECH = "AI & Technology"
CAT_POWER = "Power & Elite Activity"
CAT_ALT = "Conspiracy / Unverified Signals"
CAT_HEALTH = "Health & Science"
CAT_LOCAL = "US Local & Weather"

SECTION_ORDER = [
    CAT_WORLD,
    CAT_WAR,
    CAT_ECON,
    CAT_STOCKS,
    CAT_CRYPTO,
    CAT_TECH,
    CAT_POWER,
    CAT_HEALTH,
    CAT_LOCAL,
    CAT_ALT,
]

# ---------------------------------------------------------------------------
# Required coverage map (for blindspot detection)
# ---------------------------------------------------------------------------
REQUIRED_COVERAGE: Dict[str, List[str]] = {
    "geopolitics": ["US", "China", "Russia", "Iran"],
    "markets": ["stocks", "oil", "crypto"],
    "technology": ["AI", "semiconductors", "cyber"],
    "health": ["pandemic", "outbreak"],
    "local": ["colorado", "weather"],
}

# ---------------------------------------------------------------------------
# Load sources from shared JSON registry
# ---------------------------------------------------------------------------

def _load_sources_from_json() -> List[Source]:
    """Load the master source registry from config/sources.json."""
    try:
        raw = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error("Failed to load %s: %s — falling back to empty source list", _CONFIG_PATH, exc)
        return []

    sources: List[Source] = []
    for entry in raw.get("sources", []):
        if entry.get("type") != "rss":
            continue
        briefing_cat = entry.get("briefing_category", "")
        if not briefing_cat:
            continue
        topics_raw = entry.get("topics", [])
        topics = tuple(topics_raw) if isinstance(topics_raw, list) else ()
        sources.append(Source(
            name=entry["name"],
            url=entry["url"],
            category=briefing_cat,
            tier=entry.get("tier", 2),
            lean=entry.get("lean", "center"),
            reliability=entry.get("reliability", 0.5),
            signal_type=entry.get("signal_type", "general"),
            region=entry.get("region", "global"),
            topics=topics,
            update_frequency=entry.get("update_frequency", "medium"),
            role=entry.get("role", "signal"),
        ))

    logger.info("Loaded %d sources from %s", len(sources), _CONFIG_PATH.name)
    return sources


SOURCES: List[Source] = _load_sources_from_json()


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------

def sources_for_category(category: str) -> List[Source]:
    return [s for s in SOURCES if s.category == category]


def sources_for_role(role: str) -> List[Source]:
    """Filter sources by their pipeline role."""
    return [s for s in SOURCES if s.role == role]


def sources_for_region(region: str) -> List[Source]:
    """Filter sources by geographic focus."""
    return [s for s in SOURCES if s.region == region]


# ---------------------------------------------------------------------------
# Source weight computation
# ---------------------------------------------------------------------------

_TIER_FACTOR = {1: 1.0, 2: 0.8, 3: 0.6}
_FREQUENCY_FACTOR = {"high": 1.0, "medium": 0.8, "low": 0.6}


def compute_source_weight(source: Source) -> float:
    """
    Composite weight score combining reliability, tier, and update frequency.
    Used for signal weighting and aggregation priority.
    """
    base = source.reliability
    tier_mult = _TIER_FACTOR.get(source.tier, 0.6)
    freq_mult = _FREQUENCY_FACTOR.get(source.update_frequency, 0.8)
    return base * tier_mult * freq_mult


# ---------------------------------------------------------------------------
# Safe fetch wrapper
# ---------------------------------------------------------------------------

def safe_fetch(source: Source):
    """
    Safely fetch and parse an RSS feed with timeout and error handling.
    Returns a feedparser result dict on success, None on any failure.
    """
    try:
        import requests
        import feedparser
        resp = requests.get(
            source.url,
            timeout=5,
            headers={"User-Agent": "NewsIntelBot/1.0"},
        )
        resp.raise_for_status()
        return feedparser.parse(resp.content)
    except Exception as exc:
        logger.error("safe_fetch failed for %s: %s", source.name, exc)
        return None


# ---------------------------------------------------------------------------
# Source clusters (dynamically populated)
# ---------------------------------------------------------------------------

SOURCE_CLUSTERS: Dict[str, List[Source]] = {
    "high_trust": [s for s in SOURCES if s.reliability >= 0.85],
    "financial": [s for s in SOURCES if s.category in (CAT_ECON, CAT_STOCKS)],
    "alt": [s for s in SOURCES if s.reliability < 0.5],
}

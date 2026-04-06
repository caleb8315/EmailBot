"""
Source registry for news intelligence pipeline.

Each source has:
  - name: publisher display name
  - url: RSS feed URL
  - category: editorial section it maps to
  - tier: credibility tier (1=major wire/institutional, 2=established outlet, 3=independent/alternative)
  - lean: ideological lean tag for bias-awareness (left, center-left, center, center-right, right, independent, institutional)

Extended fields (all optional, with safe defaults):
  - reliability: float score 0.0–1.0 for source trustworthiness
  - signal_type: "breaking" | "analysis" | "narrative" | "data" | "general"
  - region: geographic focus ("US", "China", "EU", "MiddleEast", "Russia", "global")
  - topics: tuple of topic tags for coverage tracking
  - update_frequency: "high" | "medium" | "low"
  - role: "signal" | "confirmation" | "analysis" | "contrarian"
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    category: str
    tier: int  # 1=wire/institutional, 2=established, 3=independent/alt
    lean: str
    # ── Extended fields (backward-compatible defaults) ────────────────────
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

SECTION_ORDER = [
    CAT_WORLD,
    CAT_WAR,
    CAT_ECON,
    CAT_STOCKS,
    CAT_CRYPTO,
    CAT_TECH,
    CAT_POWER,
    CAT_ALT,
]

# ---------------------------------------------------------------------------
# Required coverage map (for blindspot detection)
# ---------------------------------------------------------------------------
REQUIRED_COVERAGE: Dict[str, List[str]] = {
    "geopolitics": ["US", "China", "Russia", "Iran"],
    "markets": ["stocks", "oil", "crypto"],
    "technology": ["AI", "semiconductors"],
}

# ---------------------------------------------------------------------------
# RSS Source Registry
# ---------------------------------------------------------------------------
SOURCES: List[Source] = [
    # ── World & Geopolitics ───────────────────────────────────────────────
    Source("Reuters (via Google News)",
           "https://news.google.com/rss/search?q=site:reuters.com+world&hl=en-US&gl=US&ceid=US:en",
           CAT_WORLD, 1, "center",
           reliability=0.95, signal_type="breaking", region="global",
           topics=("geopolitics", "diplomacy"), update_frequency="high", role="signal"),
    Source("AP News (via Google News)",
           "https://news.google.com/rss/search?q=site:apnews.com+world&hl=en-US&gl=US&ceid=US:en",
           CAT_WORLD, 1, "center",
           reliability=0.95, signal_type="breaking", region="global",
           topics=("geopolitics",), update_frequency="high", role="signal"),
    Source("BBC - World",
           "https://feeds.bbci.co.uk/news/world/rss.xml",
           CAT_WORLD, 1, "center",
           reliability=0.9, signal_type="breaking", region="global",
           topics=("geopolitics", "diplomacy"), update_frequency="high", role="signal"),
    Source("Al Jazeera",
           "https://www.aljazeera.com/xml/rss/all.xml",
           CAT_WORLD, 2, "center-left",
           reliability=0.8, signal_type="breaking", region="MiddleEast",
           topics=("geopolitics", "conflicts"), update_frequency="high", role="signal"),
    Source("France24",
           "https://www.france24.com/en/rss",
           CAT_WORLD, 2, "center",
           reliability=0.85, signal_type="breaking", region="EU",
           topics=("geopolitics",), update_frequency="medium", role="confirmation"),
    Source("DW News",
           "https://rss.dw.com/rdf/rss-en-world",
           CAT_WORLD, 2, "center",
           reliability=0.85, signal_type="breaking", region="EU",
           topics=("geopolitics",), update_frequency="medium", role="confirmation"),
    Source("SCMP - World",
           "https://www.scmp.com/rss/91/feed",
           CAT_WORLD, 2, "center",
           reliability=0.75, signal_type="analysis", region="China",
           topics=("geopolitics", "China"), update_frequency="medium", role="signal"),
    Source("RT",
           "https://www.rt.com/rss/news/",
           CAT_WORLD, 2, "institutional",
           reliability=0.4, signal_type="narrative", region="Russia",
           topics=("geopolitics", "Russia"), update_frequency="high", role="contrarian"),
    Source("TASS",
           "https://tass.com/rss/v2.xml",
           CAT_WORLD, 2, "institutional",
           reliability=0.4, signal_type="narrative", region="Russia",
           topics=("geopolitics", "Russia"), update_frequency="high", role="contrarian"),

    # ── Wars & Conflicts ─────────────────────────────────────────────────
    Source("BBC - World (conflicts)",
           "https://feeds.bbci.co.uk/news/world/rss.xml",
           CAT_WAR, 1, "center",
           reliability=0.9, signal_type="breaking", region="global",
           topics=("conflicts", "military"), update_frequency="high", role="confirmation"),
    Source("Al Jazeera (conflicts)",
           "https://www.aljazeera.com/xml/rss/all.xml",
           CAT_WAR, 2, "center-left",
           reliability=0.8, signal_type="breaking", region="MiddleEast",
           topics=("conflicts", "military"), update_frequency="high", role="confirmation"),
    Source("NPR - World",
           "https://feeds.npr.org/1004/rss.xml",
           CAT_WAR, 1, "center-left",
           reliability=0.85, signal_type="analysis", region="US",
           topics=("conflicts", "geopolitics"), update_frequency="medium", role="analysis"),
    Source("Guardian - World",
           "https://www.theguardian.com/world/rss",
           CAT_WAR, 1, "center-left",
           reliability=0.85, signal_type="analysis", region="EU",
           topics=("conflicts", "geopolitics"), update_frequency="medium", role="analysis"),

    # ── Economy & Markets ─────────────────────────────────────────────────
    Source("Reuters Business (via Google News)",
           "https://news.google.com/rss/search?q=site:reuters.com+economy+OR+markets&hl=en-US&gl=US&ceid=US:en",
           CAT_ECON, 1, "center",
           reliability=0.95, signal_type="breaking", region="global",
           topics=("markets", "economy"), update_frequency="high", role="signal"),
    Source("Financial Times",
           "https://www.ft.com/?format=rss",
           CAT_ECON, 1, "center-right",
           reliability=0.9, signal_type="analysis", region="global",
           topics=("markets", "economy", "stocks"), update_frequency="medium", role="analysis"),
    Source("Bloomberg (via Google News)",
           "https://news.google.com/rss/search?q=site:bloomberg.com+economy&hl=en-US&gl=US&ceid=US:en",
           CAT_ECON, 1, "center",
           reliability=0.9, signal_type="breaking", region="global",
           topics=("markets", "economy"), update_frequency="high", role="signal"),
    Source("CNBC - Economy",
           "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
           CAT_ECON, 2, "center-right",
           reliability=0.8, signal_type="data", region="US",
           topics=("markets", "economy"), update_frequency="high", role="confirmation"),
    Source("Wolf Street",
           "https://wolfstreet.com/feed/",
           CAT_ECON, 3, "independent",
           reliability=0.6, signal_type="analysis", region="US",
           topics=("economy", "housing"), update_frequency="low", role="contrarian"),

    # ── Stocks ────────────────────────────────────────────────────────────
    Source("CNBC - Stocks",
           "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069",
           CAT_STOCKS, 2, "center-right",
           reliability=0.8, signal_type="data", region="US",
           topics=("stocks",), update_frequency="high", role="signal"),
    Source("MarketWatch",
           "https://feeds.marketwatch.com/marketwatch/topstories/",
           CAT_STOCKS, 2, "center",
           reliability=0.75, signal_type="data", region="US",
           topics=("stocks", "markets"), update_frequency="high", role="signal"),
    Source("Seeking Alpha",
           "https://seekingalpha.com/market_currents.xml",
           CAT_STOCKS, 2, "center-right",
           reliability=0.65, signal_type="analysis", region="US",
           topics=("stocks",), update_frequency="high", role="analysis"),
    Source("Yahoo Finance",
           "https://finance.yahoo.com/news/rssindex",
           CAT_STOCKS, 2, "center",
           reliability=0.7, signal_type="data", region="US",
           topics=("stocks", "markets"), update_frequency="high", role="signal"),
    Source("Investor's Business Daily",
           "https://www.investors.com/feed/",
           CAT_STOCKS, 2, "center-right",
           reliability=0.75, signal_type="analysis", region="US",
           topics=("stocks",), update_frequency="medium", role="analysis"),
    Source("Barron's (via Google News)",
           "https://news.google.com/rss/search?q=site:barrons.com+stocks+OR+markets&hl=en-US&gl=US&ceid=US:en",
           CAT_STOCKS, 1, "center-right",
           reliability=0.85, signal_type="analysis", region="US",
           topics=("stocks", "markets"), update_frequency="medium", role="analysis"),

    # ── Crypto ────────────────────────────────────────────────────────────
    Source("CoinDesk",
           "https://www.coindesk.com/arc/outboundfeeds/rss/",
           CAT_CRYPTO, 2, "center",
           reliability=0.75, signal_type="breaking", region="global",
           topics=("crypto",), update_frequency="high", role="signal"),
    Source("CoinTelegraph",
           "https://cointelegraph.com/rss",
           CAT_CRYPTO, 2, "center",
           reliability=0.65, signal_type="breaking", region="global",
           topics=("crypto",), update_frequency="high", role="signal"),
    Source("Decrypt",
           "https://decrypt.co/feed",
           CAT_CRYPTO, 2, "center",
           reliability=0.7, signal_type="breaking", region="global",
           topics=("crypto",), update_frequency="high", role="signal"),
    Source("The Block",
           "https://www.theblock.co/rss.xml",
           CAT_CRYPTO, 2, "center",
           reliability=0.75, signal_type="data", region="global",
           topics=("crypto",), update_frequency="high", role="signal"),
    Source("Bitcoin Magazine",
           "https://bitcoinmagazine.com/.rss/full/",
           CAT_CRYPTO, 2, "center",
           reliability=0.6, signal_type="narrative", region="global",
           topics=("crypto",), update_frequency="medium", role="analysis"),
    Source("DL News",
           "https://www.dlnews.com/arc/outboundfeeds/rss/",
           CAT_CRYPTO, 2, "center",
           reliability=0.65, signal_type="breaking", region="global",
           topics=("crypto",), update_frequency="medium", role="signal"),

    # ── AI & Technology ───────────────────────────────────────────────────
    Source("Ars Technica - AI",
           "https://feeds.arstechnica.com/arstechnica/technology-lab",
           CAT_TECH, 2, "center-left",
           reliability=0.85, signal_type="analysis", region="US",
           topics=("AI", "technology"), update_frequency="medium", role="analysis"),
    Source("MIT Tech Review",
           "https://www.technologyreview.com/feed/",
           CAT_TECH, 2, "center",
           reliability=0.9, signal_type="analysis", region="US",
           topics=("AI", "semiconductors", "technology"), update_frequency="low", role="analysis"),
    Source("The Verge",
           "https://www.theverge.com/rss/index.xml",
           CAT_TECH, 2, "center-left",
           reliability=0.75, signal_type="breaking", region="US",
           topics=("technology",), update_frequency="high", role="signal"),
    Source("TechCrunch - AI",
           "https://techcrunch.com/category/artificial-intelligence/feed/",
           CAT_TECH, 2, "center",
           reliability=0.8, signal_type="breaking", region="US",
           topics=("AI", "technology"), update_frequency="high", role="signal"),
    Source("Wired",
           "https://www.wired.com/feed/rss",
           CAT_TECH, 2, "center-left",
           reliability=0.8, signal_type="analysis", region="US",
           topics=("AI", "technology"), update_frequency="medium", role="analysis"),

    # ── Power & Elite Activity ────────────────────────────────────────────
    Source("Reuters Politics (via Google News)",
           "https://news.google.com/rss/search?q=site:reuters.com+politics&hl=en-US&gl=US&ceid=US:en",
           CAT_POWER, 1, "center",
           reliability=0.95, signal_type="breaking", region="US",
           topics=("politics", "policy"), update_frequency="high", role="signal"),
    Source("Politico",
           "https://rss.politico.com/politics-news.xml",
           CAT_POWER, 2, "center-left",
           reliability=0.8, signal_type="breaking", region="US",
           topics=("politics", "policy"), update_frequency="high", role="signal"),
    Source("The Hill",
           "https://thehill.com/feed/",
           CAT_POWER, 2, "center",
           reliability=0.75, signal_type="breaking", region="US",
           topics=("politics",), update_frequency="high", role="signal"),
    Source("The Intercept",
           "https://theintercept.com/feed/?rss",
           CAT_POWER, 2, "left",
           reliability=0.7, signal_type="analysis", region="US",
           topics=("politics", "surveillance"), update_frequency="low", role="contrarian"),
    Source("Breitbart",
           "https://feeds.feedburner.com/breitbart",
           CAT_POWER, 2, "right",
           reliability=0.4, signal_type="narrative", region="US",
           topics=("politics",), update_frequency="high", role="contrarian"),
    Source("ProPublica",
           "https://www.propublica.org/feeds/propublica/main",
           CAT_POWER, 2, "center-left",
           reliability=0.85, signal_type="analysis", region="US",
           topics=("politics", "corruption"), update_frequency="low", role="analysis"),

    # ── Conspiracy / Unverified Signals ───────────────────────────────────
    Source("The Grayzone",
           "https://thegrayzone.com/feed/",
           CAT_ALT, 3, "independent",
           reliability=0.3, signal_type="narrative", region="global",
           topics=("geopolitics",), update_frequency="low", role="contrarian"),
    Source("Consortium News",
           "https://consortiumnews.com/feed/",
           CAT_ALT, 3, "independent",
           reliability=0.3, signal_type="narrative", region="US",
           topics=("geopolitics", "politics"), update_frequency="low", role="contrarian"),
    Source("MintPress News",
           "https://www.mintpressnews.com/feed/",
           CAT_ALT, 3, "independent",
           reliability=0.25, signal_type="narrative", region="global",
           topics=("geopolitics",), update_frequency="low", role="contrarian"),
    Source("Unlimited Hangout",
           "https://unlimitedhangout.com/feed/",
           CAT_ALT, 3, "independent",
           reliability=0.2, signal_type="narrative", region="global",
           topics=("surveillance", "corruption"), update_frequency="low", role="contrarian"),
    Source("ZeroHedge",
           "https://feeds.feedburner.com/zerohedge/feed",
           CAT_ALT, 3, "right",
           reliability=0.3, signal_type="narrative", region="US",
           topics=("markets", "economy", "geopolitics"), update_frequency="high", role="contrarian"),
    Source("Corbett Report",
           "https://www.corbettreport.com/feed/",
           CAT_ALT, 3, "independent",
           reliability=0.2, signal_type="narrative", region="global",
           topics=("surveillance", "geopolitics"), update_frequency="low", role="contrarian"),
]


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
    Does NOT modify existing fetch logic — this is an additive wrapper.
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

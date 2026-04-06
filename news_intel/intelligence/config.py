"""
Intelligence layer configuration.

All new features are gated behind ENABLE_INTELLIGENCE_LAYER.
Individual sub-features can be toggled independently.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List, Set


# ---------------------------------------------------------------------------
# Master toggle — set via env var or flip here
# ---------------------------------------------------------------------------
ENABLE_INTELLIGENCE_LAYER: bool = os.environ.get(
    "ENABLE_INTELLIGENCE_LAYER", "true"
).lower() in ("true", "1", "yes")

# ---------------------------------------------------------------------------
# Sub-feature toggles
# ---------------------------------------------------------------------------
ENABLE_SIGNAL_EXTRACTION: bool = True
ENABLE_INSIGHT_ENGINE: bool = True
ENABLE_BLINDSPOT_DETECTION: bool = True
ENABLE_POWER_NODE_TRACKING: bool = True
ENABLE_CONTRARIAN_ANALYSIS: bool = True
ENABLE_OPPORTUNITY_RADAR: bool = True

# ---------------------------------------------------------------------------
# Required coverage topics for blindspot detection
# ---------------------------------------------------------------------------
REQUIRED_TOPICS: Dict[str, List[str]] = {
    "US geopolitics": ["united states", "us ", "biden", "trump", "white house", "congress", "pentagon", "washington"],
    "China geopolitics": ["china", "beijing", "xi jinping", "chinese", "prc", "taiwan"],
    "Russia geopolitics": ["russia", "moscow", "putin", "kremlin", "russian"],
    "Iran geopolitics": ["iran", "tehran", "iranian", "khamenei"],
    "AI / Big Tech": ["artificial intelligence", "openai", "google ai", "chatgpt", "nvidia", "ai model", "machine learning", "deepseek"],
    "Crypto regulation": ["crypto regulation", "sec crypto", "bitcoin etf", "stablecoin", "cbdc", "digital currency"],
    "Energy markets": ["oil price", "crude oil", "opec", "natural gas", "energy market", "petroleum", "brent"],
    "Domestic US instability": ["protest", "civil unrest", "government shutdown", "debt ceiling", "border crisis", "domestic"],
}

# ---------------------------------------------------------------------------
# Power node entities to track
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TrackedEntity:
    name: str
    category: str  # "country", "market", "company"
    aliases: tuple  # lowercase match strings


TRACKED_ENTITIES: List[TrackedEntity] = [
    # Countries
    TrackedEntity("United States", "country", ("united states", "us ", "u.s.", "america", "washington", "biden", "trump")),
    TrackedEntity("China", "country", ("china", "beijing", "xi jinping", "chinese")),
    TrackedEntity("Russia", "country", ("russia", "moscow", "putin", "kremlin", "russian")),
    TrackedEntity("Iran", "country", ("iran", "tehran", "iranian", "khamenei")),
    TrackedEntity("Ukraine", "country", ("ukraine", "kyiv", "ukrainian", "zelenskyy", "zelensky")),
    TrackedEntity("Israel", "country", ("israel", "israeli", "netanyahu", "idf", "tel aviv")),
    # Markets
    TrackedEntity("S&P 500", "market", ("s&p 500", "s&p500", "sp500", "wall street", "stock market")),
    TrackedEntity("Bitcoin", "market", ("bitcoin", "btc")),
    TrackedEntity("Oil", "market", ("oil price", "crude oil", "brent", "wti", "petroleum", "opec")),
    TrackedEntity("Gold", "market", ("gold price", "gold futures", "bullion")),
    TrackedEntity("US Dollar", "market", ("us dollar", "dollar index", "dxy", "usd")),
    # Companies
    TrackedEntity("NVIDIA", "company", ("nvidia", "nvda")),
    TrackedEntity("Tesla", "company", ("tesla", "tsla", "elon musk")),
    TrackedEntity("OpenAI", "company", ("openai", "chatgpt", "sam altman")),
    TrackedEntity("Apple", "company", ("apple", "aapl", "iphone")),
    TrackedEntity("Google", "company", ("google", "alphabet", "googl", "gemini")),
    TrackedEntity("Microsoft", "company", ("microsoft", "msft", "copilot")),
    TrackedEntity("Meta", "company", ("meta platforms", "meta ", "facebook", "zuckerberg")),
    TrackedEntity("Amazon", "company", ("amazon", "amzn", "aws")),
]

# ---------------------------------------------------------------------------
# Signal extraction patterns (market movements)
# ---------------------------------------------------------------------------
MARKET_SIGNAL_KEYWORDS: Dict[str, Dict[str, List[str]]] = {
    "up": {
        "strong": ["surge", "soar", "rally", "spike", "jump", "skyrocket", "boom"],
        "moderate": ["rise", "gain", "climb", "advance", "increase", "up "],
    },
    "down": {
        "strong": ["crash", "plunge", "collapse", "plummet", "tank", "tumble", "freefall"],
        "moderate": ["fall", "drop", "decline", "slip", "dip", "decrease", "down "],
    },
}

GEOPOLITICAL_ESCALATION_KEYWORDS: List[str] = [
    "sanctions", "military buildup", "invasion", "strike", "attack",
    "missile", "nuclear", "war", "conflict escalat", "troops deploy",
    "embargo", "blockade", "airstrikes", "offensive",
]

GEOPOLITICAL_DEESCALATION_KEYWORDS: List[str] = [
    "ceasefire", "peace talk", "de-escalat", "diplomatic", "treaty",
    "negotiation", "withdrawal", "truce", "détente", "summit",
    "agreement", "deal", "resolution", "cooperation",
]

POLICY_KEYWORDS: List[str] = [
    "rate cut", "rate hike", "interest rate", "fed ", "federal reserve",
    "regulation", "executive order", "legislation", "tariff", "subsidy",
    "policy change", "ban", "approval", "reform",
]

CORPORATE_ACTION_KEYWORDS: List[str] = [
    "merger", "acquisition", "ipo", "layoff", "restructur",
    "earnings", "revenue", "profit", "quarterly", "partnership",
    "launch", "product", "recall", "bankruptcy", "spinoff",
]

# ---------------------------------------------------------------------------
# LLM / caching configuration
# ---------------------------------------------------------------------------
INTELLIGENCE_MODEL: str = "gpt-4o-mini"
INTELLIGENCE_TEMPERATURE: float = 0.15
INTELLIGENCE_MAX_TOKENS: int = 4000

CACHE_DIR_NAME: str = "intelligence_cache"
CACHE_TTL_HOURS: int = 12

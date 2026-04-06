"""
Signal Extraction Engine (Layer 3).

Analyzes clustered news stories and extracts meaningful change signals:
- Market movements (oil, stocks, dollar, crypto)
- Geopolitical escalations / de-escalations
- Policy changes
- Major corporate actions

Rule-based first pass, then optional LLM enrichment in the insight engine.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from news_intel.verifier import StoryCluster
from news_intel.intelligence.config import (
    MARKET_SIGNAL_KEYWORDS,
    GEOPOLITICAL_ESCALATION_KEYWORDS,
    GEOPOLITICAL_DEESCALATION_KEYWORDS,
    POLICY_KEYWORDS,
    CORPORATE_ACTION_KEYWORDS,
    TRACKED_ENTITIES,
)

logger = logging.getLogger(__name__)


@dataclass
class Signal:
    type: str       # "market", "geopolitical", "policy", "corporate"
    title: str
    direction: str  # "up", "down", "neutral", "escalation", "de-escalation"
    confidence: str  # "high", "medium", "low"
    drivers: List[str] = field(default_factory=list)
    sources_count: int = 1
    category: str = ""

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "title": self.title,
            "direction": self.direction,
            "confidence": self.confidence,
            "drivers": self.drivers,
            "sources_count": self.sources_count,
        }


def _text_for_cluster(cluster: StoryCluster) -> str:
    """Combine headline + article summaries into searchable text."""
    parts = [cluster.headline]
    for article in cluster.articles[:4]:
        parts.append(article.summary[:300])
    return " ".join(parts).lower()


def _confidence_from_sources(cluster: StoryCluster) -> str:
    n = cluster.distinct_publishers
    if n >= 3:
        return "high"
    if n >= 2:
        return "medium"
    return "low"


def _detect_market_signals(cluster: StoryCluster, text: str) -> List[Signal]:
    """Detect market movement signals from keyword patterns."""
    signals: List[Signal] = []

    for direction, strengths in MARKET_SIGNAL_KEYWORDS.items():
        for strength, keywords in strengths.items():
            for kw in keywords:
                if kw in text:
                    pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
                    pct_str = f" ({pct_match.group(0)})" if pct_match else ""

                    entities_mentioned = []
                    for entity in TRACKED_ENTITIES:
                        if entity.category == "market":
                            if any(alias in text for alias in entity.aliases):
                                entities_mentioned.append(entity.name)

                    if not entities_mentioned:
                        continue

                    for entity_name in entities_mentioned:
                        title = f"{entity_name} {direction}s{pct_str}"
                        signals.append(Signal(
                            type="market",
                            title=title,
                            direction=direction,
                            confidence=_confidence_from_sources(cluster),
                            drivers=[cluster.headline],
                            sources_count=cluster.distinct_publishers,
                            category=cluster.category,
                        ))
                    return signals  # one signal set per cluster
    return signals


def _detect_geopolitical_signals(cluster: StoryCluster, text: str) -> List[Signal]:
    """Detect geopolitical escalation/de-escalation signals."""
    signals: List[Signal] = []

    escalation_hits = [kw for kw in GEOPOLITICAL_ESCALATION_KEYWORDS if kw in text]
    deescalation_hits = [kw for kw in GEOPOLITICAL_DEESCALATION_KEYWORDS if kw in text]

    if not escalation_hits and not deescalation_hits:
        return signals

    if len(escalation_hits) > len(deescalation_hits):
        direction = "escalation"
        drivers = escalation_hits[:3]
    elif len(deescalation_hits) > len(escalation_hits):
        direction = "de-escalation"
        drivers = deescalation_hits[:3]
    else:
        direction = "neutral"
        drivers = (escalation_hits + deescalation_hits)[:3]

    signals.append(Signal(
        type="geopolitical",
        title=cluster.headline,
        direction=direction,
        confidence=_confidence_from_sources(cluster),
        drivers=drivers,
        sources_count=cluster.distinct_publishers,
        category=cluster.category,
    ))
    return signals


def _detect_policy_signals(cluster: StoryCluster, text: str) -> List[Signal]:
    """Detect policy change signals."""
    hits = [kw for kw in POLICY_KEYWORDS if kw in text]
    if not hits:
        return []
    return [Signal(
        type="policy",
        title=cluster.headline,
        direction="neutral",
        confidence=_confidence_from_sources(cluster),
        drivers=hits[:3],
        sources_count=cluster.distinct_publishers,
        category=cluster.category,
    )]


def _detect_corporate_signals(cluster: StoryCluster, text: str) -> List[Signal]:
    """Detect major corporate action signals."""
    hits = [kw for kw in CORPORATE_ACTION_KEYWORDS if kw in text]
    if not hits:
        return []
    return [Signal(
        type="corporate",
        title=cluster.headline,
        direction="neutral",
        confidence=_confidence_from_sources(cluster),
        drivers=hits[:3],
        sources_count=cluster.distinct_publishers,
        category=cluster.category,
    )]


def extract_signals(clusters: List[StoryCluster]) -> List[Signal]:
    """
    Main entry point: extract signals from all clusters.

    Returns deduplicated signals sorted by confidence and source count.
    """
    all_signals: List[Signal] = []
    seen_titles: set = set()

    for cluster in clusters:
        text = _text_for_cluster(cluster)

        for detector in [
            _detect_market_signals,
            _detect_geopolitical_signals,
            _detect_policy_signals,
            _detect_corporate_signals,
        ]:
            try:
                new_signals = detector(cluster, text)
                for sig in new_signals:
                    title_key = sig.title.lower()[:60]
                    if title_key not in seen_titles:
                        seen_titles.add(title_key)
                        all_signals.append(sig)
            except Exception as exc:
                logger.warning("Signal detector %s failed on cluster %d: %s",
                               detector.__name__, cluster.cluster_id, exc)

    all_signals.sort(
        key=lambda s: (
            {"high": 3, "medium": 2, "low": 1}.get(s.confidence, 0),
            s.sources_count,
        ),
        reverse=True,
    )

    logger.info(
        "Extracted %d signals: %d market, %d geopolitical, %d policy, %d corporate",
        len(all_signals),
        sum(1 for s in all_signals if s.type == "market"),
        sum(1 for s in all_signals if s.type == "geopolitical"),
        sum(1 for s in all_signals if s.type == "policy"),
        sum(1 for s in all_signals if s.type == "corporate"),
    )
    return all_signals

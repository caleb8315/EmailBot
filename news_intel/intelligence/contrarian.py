"""
Contrarian Analysis Engine.

Detects consensus narratives across multiple sources and flags
the risk of being wrong. When many sources agree on a direction,
that's precisely when contrarian thinking is most valuable.

Rule-based consensus detection from signals and clusters.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List

from news_intel.verifier import StoryCluster
from news_intel.intelligence.signal_extractor import Signal

logger = logging.getLogger(__name__)

CONSENSUS_THRESHOLD = 3  # min sources pointing the same direction to flag


@dataclass
class ContrarianAlert:
    consensus: str
    risk: str
    source_count: int = 0

    def to_dict(self) -> dict:
        return {
            "consensus": self.consensus,
            "risk": self.risk,
        }


def _detect_directional_consensus(signals: List[Signal]) -> List[ContrarianAlert]:
    """Find cases where multiple signals agree on a market direction."""
    alerts: List[ContrarianAlert] = []

    direction_groups: Dict[str, List[Signal]] = {}
    for sig in signals:
        if sig.type == "market" and sig.direction in ("up", "down"):
            key = sig.direction
            direction_groups.setdefault(key, []).append(sig)

    for direction, sigs in direction_groups.items():
        total_sources = sum(s.sources_count for s in sigs)
        if total_sources >= CONSENSUS_THRESHOLD:
            entities = list({s.title.split()[0] for s in sigs})
            entity_str = ", ".join(entities[:3])
            opposite = "down" if direction == "up" else "up"

            alerts.append(ContrarianAlert(
                consensus=f"Multiple sources signal {entity_str} moving {direction}",
                risk=f"If wrong → sharp reversal {opposite}, catch positioned traders off guard",
                source_count=total_sources,
            ))

    return alerts


def _detect_narrative_consensus(signals: List[Signal]) -> List[ContrarianAlert]:
    """Find cases where geopolitical signals converge on one narrative."""
    alerts: List[ContrarianAlert] = []

    geo_signals = [s for s in signals if s.type == "geopolitical"]
    if len(geo_signals) < 2:
        return alerts

    escalation_count = sum(1 for s in geo_signals if s.direction == "escalation")
    deescalation_count = sum(1 for s in geo_signals if s.direction == "de-escalation")

    if escalation_count >= CONSENSUS_THRESHOLD:
        alerts.append(ContrarianAlert(
            consensus="Dominant narrative: geopolitical escalation",
            risk="If wrong → risk assets rally, defense stocks pull back, safe havens decline",
            source_count=escalation_count,
        ))
    elif deescalation_count >= CONSENSUS_THRESHOLD:
        alerts.append(ContrarianAlert(
            consensus="Dominant narrative: geopolitical de-escalation / resolution",
            risk="If wrong → sudden escalation catches markets unprepared, oil and defense spike",
            source_count=deescalation_count,
        ))

    return alerts


def _detect_category_consensus(clusters: List[StoryCluster]) -> List[ContrarianAlert]:
    """Detect when all stories in a category share the same tone."""
    alerts: List[ContrarianAlert] = []

    by_category: Dict[str, List[StoryCluster]] = {}
    for c in clusters:
        by_category.setdefault(c.category, []).append(c)

    for category, cat_clusters in by_category.items():
        if len(cat_clusters) < 3:
            continue

        headlines_lower = [c.headline.lower() for c in cat_clusters]
        positive_words = ["rally", "surge", "boom", "gain", "success", "record", "breakthrough"]
        negative_words = ["crash", "crisis", "collapse", "fail", "plunge", "warning", "threat"]

        pos_count = sum(
            1 for h in headlines_lower
            if any(w in h for w in positive_words)
        )
        neg_count = sum(
            1 for h in headlines_lower
            if any(w in h for w in negative_words)
        )

        total = len(cat_clusters)
        if pos_count >= total * 0.7 and pos_count >= 3:
            alerts.append(ContrarianAlert(
                consensus=f"{category}: overwhelmingly positive coverage",
                risk="Uniform optimism often precedes corrections — watch for divergent signals",
                source_count=pos_count,
            ))
        elif neg_count >= total * 0.7 and neg_count >= 3:
            alerts.append(ContrarianAlert(
                consensus=f"{category}: overwhelmingly negative coverage",
                risk="Peak pessimism can signal bottoming — contrarian opportunity?",
                source_count=neg_count,
            ))

    return alerts


def analyze_contrarian(
    signals: List[Signal],
    clusters: List[StoryCluster],
) -> List[ContrarianAlert]:
    """
    Main entry point: detect consensus narratives and flag contrarian risks.

    Returns alerts sorted by source count.
    """
    all_alerts: List[ContrarianAlert] = []

    for detector in [
        lambda: _detect_directional_consensus(signals),
        lambda: _detect_narrative_consensus(signals),
        lambda: _detect_category_consensus(clusters),
    ]:
        try:
            all_alerts.extend(detector())
        except Exception as exc:
            logger.warning("Contrarian detector failed: %s", exc)

    all_alerts.sort(key=lambda a: a.source_count, reverse=True)

    logger.info("Generated %d contrarian alerts", len(all_alerts))
    return all_alerts

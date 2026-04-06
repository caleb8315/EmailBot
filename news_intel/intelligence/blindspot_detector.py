"""
Blindspot Detection System (Layer 5).

Identifies gaps in news coverage by checking whether required
topic areas have any representation in today's story clusters.

Pure rule-based — no LLM dependency.
"""

from __future__ import annotations

import logging
from typing import Dict, List

from news_intel.verifier import StoryCluster
from news_intel.intelligence.config import REQUIRED_TOPICS

logger = logging.getLogger(__name__)


def _build_corpus(clusters: List[StoryCluster]) -> str:
    """Build a single lowercase text corpus from all clusters."""
    parts: List[str] = []
    for cluster in clusters:
        parts.append(cluster.headline)
        for article in cluster.articles[:3]:
            parts.append(article.title)
            parts.append(article.summary[:200])
    return " ".join(parts).lower()


def detect_blindspots(clusters: List[StoryCluster]) -> List[str]:
    """
    Check required topics against today's coverage.

    Returns a list of human-readable blindspot warnings for topics
    that have no matching stories.
    """
    if not clusters:
        return [f"No {topic} detected" for topic in REQUIRED_TOPICS]

    corpus = _build_corpus(clusters)
    blindspots: List[str] = []

    for topic, keywords in REQUIRED_TOPICS.items():
        if not any(kw in corpus for kw in keywords):
            blindspots.append(f"No major {topic} updates detected")

    if blindspots:
        logger.info("Detected %d blindspots: %s", len(blindspots), blindspots)
    else:
        logger.info("No blindspots detected — all required topics covered")

    return blindspots

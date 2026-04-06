"""
Power Node Tracking (Layer 4).

Tracks mentions and activity levels of key geopolitical,
market, and corporate entities across today's news clusters.

Pure rule-based — no LLM dependency.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from news_intel.verifier import StoryCluster
from news_intel.intelligence.config import TRACKED_ENTITIES, TrackedEntity

logger = logging.getLogger(__name__)


@dataclass
class PowerNode:
    entity: str
    entity_category: str  # "country", "market", "company"
    activity: str         # "high", "medium", "low"
    context: str
    mention_count: int
    cluster_ids: List[int] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "entity": self.entity,
            "activity": self.activity,
            "context": self.context,
            "mention_count": self.mention_count,
        }


def _count_mentions(
    entity: TrackedEntity,
    clusters: List[StoryCluster],
) -> Tuple[int, List[int], List[str]]:
    """Count how many clusters mention this entity, return (count, cluster_ids, contexts)."""
    count = 0
    cids: List[int] = []
    contexts: List[str] = []

    for cluster in clusters:
        text = (cluster.headline + " " + " ".join(
            a.summary[:200] for a in cluster.articles[:3]
        )).lower()

        if any(alias in text for alias in entity.aliases):
            count += 1
            cids.append(cluster.cluster_id)
            contexts.append(cluster.headline)

    return count, cids, contexts


def _activity_level(mention_count: int, total_clusters: int) -> str:
    if total_clusters == 0:
        return "low"
    ratio = mention_count / total_clusters
    if mention_count >= 4 or ratio >= 0.25:
        return "high"
    if mention_count >= 2 or ratio >= 0.10:
        return "medium"
    return "low"


def _pick_context(contexts: List[str]) -> str:
    """Pick the most informative context headline."""
    if not contexts:
        return "No specific context"
    return sorted(contexts, key=len, reverse=True)[0][:120]


def track_power_nodes(clusters: List[StoryCluster]) -> List[PowerNode]:
    """
    Main entry point: scan clusters for tracked entity mentions.

    Returns PowerNode objects for entities with at least 1 mention,
    sorted by mention count descending.
    """
    nodes: List[PowerNode] = []
    total = len(clusters)

    for entity in TRACKED_ENTITIES:
        count, cids, contexts = _count_mentions(entity, clusters)
        if count == 0:
            continue

        activity = _activity_level(count, total)
        context = _pick_context(contexts)

        nodes.append(PowerNode(
            entity=entity.name,
            entity_category=entity.category,
            activity=activity,
            context=context,
            mention_count=count,
            cluster_ids=cids,
        ))

    nodes.sort(key=lambda n: n.mention_count, reverse=True)

    logger.info(
        "Tracked %d active power nodes (high: %d, medium: %d, low: %d)",
        len(nodes),
        sum(1 for n in nodes if n.activity == "high"),
        sum(1 for n in nodes if n.activity == "medium"),
        sum(1 for n in nodes if n.activity == "low"),
    )
    return nodes

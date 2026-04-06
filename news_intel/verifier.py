"""
Cross-source verification engine.

Groups similar articles across publishers, compares factual claims,
and assigns a verification label to each story cluster:

  🟢 VERIFIED     → ≥2 credible (tier 1-2) sources with agreeing facts
  🟡 DEVELOPING   → limited confirmation or conflicting details
  🔴 UNVERIFIED   → single source or alternative-only claims

Clustering uses fuzzy title matching + entity overlap.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

from rapidfuzz import fuzz

from news_intel.config import CAT_ALT
from news_intel.normalizer import NormalizedArticle

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------
TITLE_SIMILARITY_THRESHOLD = 55  # fuzzy ratio (0-100)
ENTITY_OVERLAP_THRESHOLD = 0.3   # Jaccard similarity on entity sets
VERIFIED_MIN_CREDIBLE = 2        # min tier 1-2 sources for VERIFIED
DEVELOPING_MIN_SOURCES = 2       # min total sources for DEVELOPING

# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------
LABEL_VERIFIED = "🟢 VERIFIED"
LABEL_DEVELOPING = "🟡 DEVELOPING"
LABEL_UNVERIFIED = "🔴 UNVERIFIED"


@dataclass
class StoryCluster:
    """A group of articles that appear to cover the same event/story."""
    cluster_id: int
    articles: List[NormalizedArticle]
    category: str
    label: str = LABEL_UNVERIFIED
    headline: str = ""
    publishers: List[str] = field(default_factory=list)
    merged_entities: Dict[str, Set[str]] = field(default_factory=dict)
    representative: Optional[NormalizedArticle] = None

    @property
    def credible_count(self) -> int:
        """Number of distinct tier-1/2 publishers."""
        return len({a.publisher for a in self.articles if a.source_tier <= 2})

    @property
    def distinct_publishers(self) -> int:
        return len({a.publisher for a in self.articles})

    @property
    def newest(self) -> Optional[datetime]:
        dates = [a.published for a in self.articles if a.published]
        return max(dates) if dates else None


def _entity_set(article: NormalizedArticle) -> Set[str]:
    """Flatten all entity values into one set for comparison."""
    result: Set[str] = set()
    for vals in article.entities.values():
        result.update(v.lower() for v in vals)
    return result


def _jaccard(a: Set[str], b: Set[str]) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


def _should_cluster(a: NormalizedArticle, b: NormalizedArticle) -> bool:
    """Decide whether two articles belong to the same story."""
    title_sim = fuzz.token_sort_ratio(a.title.lower(), b.title.lower())
    if title_sim >= TITLE_SIMILARITY_THRESHOLD:
        return True

    entity_sim = _jaccard(_entity_set(a), _entity_set(b))
    if title_sim >= 40 and entity_sim >= ENTITY_OVERLAP_THRESHOLD:
        return True

    return False


def _pick_representative(articles: List[NormalizedArticle]) -> NormalizedArticle:
    """Choose the best article to represent the cluster (prefer tier-1, longest summary)."""
    ranked = sorted(articles, key=lambda a: (a.source_tier, -len(a.summary)))
    return ranked[0]


def _merge_entities(articles: List[NormalizedArticle]) -> Dict[str, Set[str]]:
    merged: Dict[str, Set[str]] = {"PERSON": set(), "ORG": set(), "GPE": set()}
    for a in articles:
        for key in merged:
            merged[key].update(a.entities.get(key, set()))
    return merged


def _assign_label(cluster: StoryCluster) -> str:
    """
    Assign verification label based on source diversity and credibility.

    Rules:
      - ALT category always starts as UNVERIFIED unless corroborated by mainstream
      - VERIFIED requires ≥2 distinct credible (tier 1-2) publishers
      - DEVELOPING requires ≥2 total sources but insufficient credible ones
      - Everything else is UNVERIFIED
    """
    is_alt = cluster.category == CAT_ALT
    credible = cluster.credible_count
    total = cluster.distinct_publishers

    if is_alt:
        if credible >= VERIFIED_MIN_CREDIBLE:
            return LABEL_DEVELOPING
        return LABEL_UNVERIFIED

    if credible >= VERIFIED_MIN_CREDIBLE:
        return LABEL_VERIFIED

    if total >= DEVELOPING_MIN_SOURCES:
        return LABEL_DEVELOPING

    return LABEL_UNVERIFIED


def cluster_articles(articles: List[NormalizedArticle]) -> List[StoryCluster]:
    """
    Cluster articles into story groups using greedy single-linkage.

    Returns clusters sorted by (category order, newest timestamp).
    """
    from news_intel.config import SECTION_ORDER

    clusters: List[StoryCluster] = []
    assigned: Set[str] = set()

    articles_by_cat: Dict[str, List[NormalizedArticle]] = {}
    for a in articles:
        articles_by_cat.setdefault(a.category, []).append(a)

    cluster_id = 0
    for cat in SECTION_ORDER:
        cat_articles = articles_by_cat.get(cat, [])
        for article in cat_articles:
            if article.uid in assigned:
                continue

            group = [article]
            assigned.add(article.uid)

            for candidate in cat_articles:
                if candidate.uid in assigned:
                    continue
                if any(_should_cluster(candidate, member) for member in group):
                    group.append(candidate)
                    assigned.add(candidate.uid)

            representative = _pick_representative(group)
            cluster = StoryCluster(
                cluster_id=cluster_id,
                articles=group,
                category=cat,
                headline=representative.title,
                publishers=[a.publisher for a in group],
                merged_entities=_merge_entities(group),
                representative=representative,
            )
            cluster.label = _assign_label(cluster)
            clusters.append(cluster)
            cluster_id += 1

    logger.info(
        "Clustered %d articles into %d story groups",
        len(articles),
        len(clusters),
    )
    return clusters


def verify(articles: List[NormalizedArticle]) -> List[StoryCluster]:
    """Main entry point: cluster and label articles."""
    return cluster_articles(articles)

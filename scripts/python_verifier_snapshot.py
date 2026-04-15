#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Set

from news_intel.verifier import verify


def load_snapshot(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    articles = data.get("articles", [])
    if not isinstance(articles, list):
        raise ValueError("snapshot must include an 'articles' array")
    return articles


def to_article(row: Dict[str, Any]) -> SimpleNamespace:
    entities_raw = row.get("entities", {})
    entities: Dict[str, Set[str]] = {
        "PERSON": set(entities_raw.get("PERSON", [])),
        "ORG": set(entities_raw.get("ORG", [])),
        "GPE": set(entities_raw.get("GPE", [])),
    }
    return SimpleNamespace(
        uid=row.get("uid") or row.get("id"),
        title=row.get("title", ""),
        publisher=row.get("publisher") or row.get("source", ""),
        category=row.get("category", "world"),
        published=None,
        summary=row.get("summary", ""),
        entities=entities,
        link=row.get("link", ""),
        source_tier=int(row.get("source_tier", 3)),
        source_lean=row.get("source_lean", "unknown"),
    )


def main() -> int:
    snapshot_arg = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/cluster_parity_snapshot.json"
    snapshot_path = Path(snapshot_arg)
    if not snapshot_path.exists():
        print(json.dumps({"error": f"snapshot not found: {snapshot_arg}"}))
        return 1

    rows = load_snapshot(snapshot_path)
    articles = [to_article(row) for row in rows]
    clusters = verify(articles)

    payload = {
        "clusters": [
            {
                "headline": cluster.headline,
                "label": cluster.label,
                "category": cluster.category,
                "source_count": cluster.distinct_publishers,
                "credible_count": cluster.credible_count,
                "story_ids": sorted([article.uid for article in cluster.articles]),
            }
            for cluster in clusters
        ]
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

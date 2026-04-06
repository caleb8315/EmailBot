"""
RSS feed ingestion module.

Fetches all configured feeds concurrently, returns raw entry dicts
keyed by source metadata. Handles timeouts and malformed feeds gracefully.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import feedparser
from dateutil import parser as dateparser

from news_intel.config import SOURCES, Source

logger = logging.getLogger(__name__)

FETCH_TIMEOUT_SECONDS = 15
MAX_WORKERS = 12
MAX_ENTRIES_PER_FEED = 30


@dataclass
class RawArticle:
    title: str
    link: str
    published: Optional[datetime]
    summary_html: str
    source: Source
    raw_entry: Dict[str, Any] = field(repr=False)


def _parse_date(entry: dict) -> Optional[datetime]:
    for key in ("published", "updated", "created"):
        raw = entry.get(key)
        if raw:
            try:
                return dateparser.parse(raw).astimezone(timezone.utc)
            except (ValueError, TypeError):
                continue
    struct = entry.get("published_parsed") or entry.get("updated_parsed")
    if struct:
        try:
            return datetime(*struct[:6], tzinfo=timezone.utc)
        except Exception:
            pass
    return None


def _fetch_one(source: Source) -> List[RawArticle]:
    """Fetch and parse a single RSS feed. Returns [] on failure."""
    try:
        feed = feedparser.parse(
            source.url,
            request_headers={"User-Agent": "NewsIntelBot/1.0"},
        )
        if feed.bozo and not feed.entries:
            logger.warning("Bozo feed (no entries): %s – %s", source.name, feed.bozo_exception)
            return []

        articles: List[RawArticle] = []
        for entry in feed.entries[:MAX_ENTRIES_PER_FEED]:
            title = entry.get("title", "").strip()
            if not title:
                continue
            articles.append(
                RawArticle(
                    title=title,
                    link=entry.get("link", ""),
                    published=_parse_date(entry),
                    summary_html=entry.get("summary", ""),
                    source=source,
                    raw_entry=dict(entry),
                )
            )
        logger.info("Fetched %d articles from %s", len(articles), source.name)
        return articles

    except Exception as exc:
        logger.error("Failed to fetch %s: %s", source.name, exc)
        return []


def fetch_all(sources: Optional[List[Source]] = None) -> List[RawArticle]:
    """
    Fetch all configured RSS feeds in parallel.
    Returns a flat list of RawArticle objects sorted by publish time (newest first).
    """
    sources = sources or SOURCES
    all_articles: List[RawArticle] = []
    t0 = time.monotonic()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_fetch_one, src): src for src in sources}
        for future in as_completed(futures):
            try:
                all_articles.extend(future.result())
            except Exception as exc:
                logger.error("Worker error for %s: %s", futures[future].name, exc)

    all_articles.sort(key=lambda a: a.published or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    elapsed = time.monotonic() - t0
    logger.info("Fetched %d total articles from %d sources in %.1fs", len(all_articles), len(sources), elapsed)
    return all_articles

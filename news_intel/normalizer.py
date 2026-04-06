"""
Article normalization module.

Converts raw RSS entries into structured NormalizedArticle objects with:
  - cleaned plain-text summary
  - extracted named entities (people, orgs, locations)
  - category assignment from source config
"""

from __future__ import annotations

import html
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

from news_intel.rss_fetcher import RawArticle

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lightweight entity extraction (no ML dependency required at runtime)
# Tries spaCy if available, falls back to regex heuristics.
# ---------------------------------------------------------------------------
_NLP = None
_NLP_LOADED = False


def _get_nlp():
    global _NLP, _NLP_LOADED
    if _NLP_LOADED:
        return _NLP
    _NLP_LOADED = True
    try:
        import spacy
        _NLP = spacy.load("en_core_web_sm")
        logger.info("spaCy NER loaded (en_core_web_sm)")
    except Exception:
        logger.info("spaCy not available – falling back to regex entity extraction")
        _NLP = None
    return _NLP


# Regex fallback: capitalized multi-word names (2–4 words)
_ENTITY_RE = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b")
# Common false-positive prefixes
_ENTITY_STOPWORDS = {
    "The Associated", "Associated Press", "Read More", "New York",
    "Click Here", "Last Updated", "Getty Images", "Photo Credit",
    "Share This", "Sign Up", "Breaking News",
}


@dataclass
class NormalizedArticle:
    uid: str  # deterministic id: hash(link)
    title: str
    publisher: str
    category: str
    published: Optional[datetime]
    summary: str  # plain-text, 3-5 sentences max
    entities: Dict[str, Set[str]]  # {"PERSON": {...}, "ORG": {...}, "GPE": {...}}
    link: str
    source_tier: int
    source_lean: str

    def __hash__(self):
        return hash(self.uid)

    def __eq__(self, other):
        return isinstance(other, NormalizedArticle) and self.uid == other.uid


def _strip_html(raw: str) -> str:
    text = html.unescape(raw)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _truncate_summary(text: str, max_sentences: int = 5) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(sentences[:max_sentences])


def _extract_entities_spacy(text: str) -> Dict[str, Set[str]]:
    nlp = _get_nlp()
    if nlp is None:
        return _extract_entities_regex(text)
    doc = nlp(text[:5000])
    entities: Dict[str, Set[str]] = {"PERSON": set(), "ORG": set(), "GPE": set()}
    for ent in doc.ents:
        if ent.label_ in entities:
            entities[ent.label_].add(ent.text.strip())
    return entities


def _extract_entities_regex(text: str) -> Dict[str, Set[str]]:
    """Best-effort entity extraction without ML."""
    found = set(_ENTITY_RE.findall(text)) - _ENTITY_STOPWORDS
    return {"PERSON": set(), "ORG": set(), "GPE": found}


def _make_uid(link: str) -> str:
    import hashlib
    return hashlib.sha256(link.encode()).hexdigest()[:16]


def normalize(raw: RawArticle) -> NormalizedArticle:
    plain_summary = _strip_html(raw.summary_html)
    truncated = _truncate_summary(plain_summary)
    combined_text = f"{raw.title}. {truncated}"
    entities = _extract_entities_spacy(combined_text)

    return NormalizedArticle(
        uid=_make_uid(raw.link),
        title=raw.title,
        publisher=raw.source.name,
        category=raw.source.category,
        published=raw.published,
        summary=truncated if truncated else raw.title,
        entities=entities,
        link=raw.link,
        source_tier=raw.source.tier,
        source_lean=raw.source.lean,
    )


def normalize_batch(raw_articles: List[RawArticle]) -> List[NormalizedArticle]:
    seen_uids: set = set()
    results: List[NormalizedArticle] = []
    for raw in raw_articles:
        article = normalize(raw)
        if article.uid not in seen_uids:
            seen_uids.add(article.uid)
            results.append(article)
    logger.info("Normalized %d articles (%d unique)", len(raw_articles), len(results))
    return results

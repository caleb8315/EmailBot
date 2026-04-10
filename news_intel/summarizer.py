"""
AI summarization module.

Uses an LLM provider for:
  - Distilling story clusters into 1–3 bullet summaries
  - Generating a "Big This Week" recap from older context articles
  - Generating an "On the Radar" section for upcoming events
  - Neutral tone enforcement
  - Bias dampening across ideologically diverse sources

Batches everything into a single API call to minimize cost.
"""

from __future__ import annotations

import json
import logging
from typing import Dict, List, Optional

from news_intel.verifier import StoryCluster
from news_intel.normalizer import NormalizedArticle
from news_intel.config import CAT_ALT, SECTION_ORDER
from news_intel.llm_client import (
    create_openai_client,
    get_model_for_workload,
    has_llm_credentials,
    call_with_retry,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a neutral news analyst producing a daily intelligence briefing.

RULES:
1. NEVER use sensational, emotional, or persuasive language.
2. NEVER draw conclusions without citing the source of the claim.
3. State ONLY what sources report. If sources conflict, state both positions.
4. If something is unclear or unconfirmed, say so explicitly.
5. Use precise, clinical language. Write like a wire-service editor.
6. Attribute significant claims: "According to [Publisher], ..."
7. For items marked ALTERNATIVE/UNVERIFIED: preface with uncertainty language
   ("It is alleged that...", "Unconfirmed reports suggest...").

OUTPUT FORMAT:
Return a JSON object with these keys:
  "stories": { "1": "summary text", "2": "summary text", ... }
  "big_this_week": "bullet list of major ongoing stories"
  "on_the_radar": "bullet list of upcoming events to watch"
  "market_sentiment": { "Economy & Markets": {"score": 0.0, "note": ""}, "Stocks": {"score": 0.0, "note": ""}, "Crypto": {"score": 0.0, "note": ""} }

For stories:
  - Write 2-4 informative sentences that explain WHAT happened, WHO is involved, and WHY it matters.
  - Include specific details: numbers, names, dates, locations, consequences.
  - Don't just restate the headline — add context and explain the significance.
  - Start each bullet with "• " prefix. Use 2-3 bullets per story.

For big_this_week: 3-5 bullets covering the dominant narratives of the week so far. Each bullet should be 2 sentences.
For on_the_radar: 3-5 bullets about upcoming events with specific dates if known (earnings, hearings, summits, votes, launches, policy deadlines, etc). Each bullet should be 1-2 sentences.
For market_sentiment: rate the overall tone of coverage for each financial category on a scale of -5 (very bearish/negative) to +5 (very bullish/positive). 0 is neutral. Include a 1-sentence note explaining the mood.

Return ONLY valid JSON, no markdown fencing, no commentary.
"""

ALT_DISCLAIMER = (
    "⚠️ DISCLAIMER: The following item comes from alternative/independent sources "
    "and has not been independently verified by mainstream outlets. "
    "It is included for signal monitoring only — not as established fact."
)


def _build_batch_prompt(
    clusters: List[StoryCluster],
    context_articles: List[NormalizedArticle] | None = None,
) -> str:
    """Build a single prompt containing all stories + weekly context."""
    parts = [f"TODAY'S TOP {len(clusters)} STORIES:\n"]

    for i, cluster in enumerate(clusters):
        is_alt = cluster.category == CAT_ALT
        sources = ", ".join(sorted(set(cluster.publishers)))
        parts.append(f"--- STORY {i + 1} ---")
        parts.append(f"Headline: {cluster.headline}")
        parts.append(f"Verification: {cluster.label}")
        parts.append(f"Category: {cluster.category}")
        parts.append(f"Sources: {sources}")
        if is_alt:
            parts.append("NOTE: This is ALTERNATIVE/UNVERIFIED. Use cautious language.")

        for article in cluster.articles[:4]:
            parts.append(f"  [{article.publisher}] {article.summary[:300]}")
        parts.append("")

    if context_articles:
        parts.append("\n--- CONTEXT: MAJOR HEADLINES FROM EARLIER THIS WEEK ---")
        parts.append("Use these to write the 'big_this_week' and 'on_the_radar' sections.\n")
        seen_titles: set = set()
        count = 0
        for a in context_articles:
            title_key = a.title[:60].lower()
            if title_key in seen_titles:
                continue
            seen_titles.add(title_key)
            parts.append(f"  [{a.publisher}] {a.title}")
            count += 1
            if count >= 40:
                break
        parts.append("")

    parts.append(
        "Now produce the JSON with 'stories', 'big_this_week', and 'on_the_radar'. "
        "For 'on_the_radar', identify any upcoming events, deadlines, votes, summits, "
        "earnings reports, product launches, or court dates mentioned in today's stories or the weekly context."
    )

    return "\n".join(parts)


def _call_openai_batch(system: str, user: str, num_stories: int) -> Optional[str]:
    """Single LLM call for all stories. Returns raw response text."""
    try:
        client = create_openai_client()
        if client is None:
            return None
        model = get_model_for_workload("python_intel")
        max_tokens = min(150 * num_stories + 800, 8000)
        response = call_with_retry(
            "python_summarizer_batch",
            lambda: client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.2,
                max_tokens=max_tokens,
            ),
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        logger.error("LLM batch call failed: %s", exc)
        return None


def _parse_batch_response(raw: str) -> dict:
    """Parse the JSON response from the batch call."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Failed to parse batch JSON response, using fallbacks")
        return {}


def _fallback_summary(cluster: StoryCluster) -> str:
    """Generate a basic extractive summary when OpenAI is unavailable."""
    rep = cluster.representative
    if not rep:
        return cluster.headline
    bullets = rep.summary.split(". ")[:3]
    return "\n".join(f"• {b.strip().rstrip('.')}." for b in bullets if b.strip())


def summarize_all(
    clusters: List[StoryCluster],
    context_articles: List[NormalizedArticle] | None = None,
) -> List[StoryCluster]:
    """
    Summarize all clusters + generate weekly recap in a SINGLE OpenAI API call.
    Falls back to extractive summaries if the API is unavailable.

    Attaches to clusters:
      - cluster.ai_summary (per-story bullets)

    Returns clusters. Also attaches two module-level attributes:
      - summarizer.big_this_week
      - summarizer.on_the_radar
    """
    global big_this_week, on_the_radar, sentiment_scores, sentiment_notes
    big_this_week = ""
    on_the_radar = ""
    sentiment_scores = {}
    sentiment_notes = {}

    if not has_llm_credentials():
        logger.info("No valid LLM key — using fallback summaries for all %d clusters", len(clusters))
        for cluster in clusters:
            summary = _fallback_summary(cluster)
            if cluster.category == CAT_ALT:
                summary = f"{ALT_DISCLAIMER}\n\n{summary}"
            cluster.ai_summary = summary  # type: ignore[attr-defined]
        return clusters

    prompt = _build_batch_prompt(clusters, context_articles)
    logger.info("Sending 1 batch request to LLM for %d stories + context (%d chars)", len(clusters), len(prompt))
    raw = _call_openai_batch(SYSTEM_PROMPT, prompt, len(clusters))

    parsed: dict = {}
    if raw:
        parsed = _parse_batch_response(raw)
        stories = parsed.get("stories", {})
        logger.info("Parsed %d/%d story summaries from LLM", len(stories), len(clusters))
    else:
        stories = {}

    raw_btw = parsed.get("big_this_week", "")
    raw_otr = parsed.get("on_the_radar", "")
    big_this_week = "\n".join(raw_btw) if isinstance(raw_btw, list) else str(raw_btw or "")
    on_the_radar = "\n".join(raw_otr) if isinstance(raw_otr, list) else str(raw_otr or "")

    raw_sentiment = parsed.get("market_sentiment", {})
    if isinstance(raw_sentiment, dict):
        for cat, val in raw_sentiment.items():
            if isinstance(val, dict):
                sentiment_scores[cat] = float(val.get("score", 0))
                sentiment_notes[cat] = str(val.get("note", ""))
            elif isinstance(val, (int, float)):
                sentiment_scores[cat] = float(val)

    if big_this_week:
        logger.info("Generated 'Big This Week' section")
    if on_the_radar:
        logger.info("Generated 'On the Radar' section")
    if sentiment_scores:
        logger.info("Extracted sentiment: %s", {k: f"{v:+.1f}" for k, v in sentiment_scores.items()})

    for i, cluster in enumerate(clusters):
        key = str(i + 1)
        summary = stories.get(key)
        if not summary:
            summary = _fallback_summary(cluster)
        if cluster.category == CAT_ALT:
            summary = f"{ALT_DISCLAIMER}\n\n{summary}"
        cluster.ai_summary = summary  # type: ignore[attr-defined]

    logger.info("Summarized %d story clusters (1 API call)", len(clusters))
    return clusters


big_this_week: str = ""
on_the_radar: str = ""
sentiment_scores: Dict[str, float] = {}
sentiment_notes: Dict[str, str] = {}

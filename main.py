#!/usr/bin/env python3
"""
Daily News Intelligence Briefing — main orchestrator.

Pipeline:
  1. Fetch RSS feeds from all configured sources
  2. Filter to articles from the past 7 days
  3. Normalize articles (extract entities, clean text)
  4. Cluster and verify stories across sources
  5. Summarize via OpenAI (with fallback)
  6. Format as HTML + plain text (or structured JSON)
  7. Email the briefing

Usage:
  python main.py                      # full pipeline + email
  python main.py --dry-run            # fetch + normalize only, no AI, no email
  python main.py --no-email           # full pipeline, skip email delivery
  python main.py --category "Crypto"  # filter to one section
  python main.py --output-json        # output structured JSON (for OpenClaw)
  python main.py --preferences-file path/to/prefs.json  # OpenClaw prefs override
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from news_intel.config import SOURCES
from news_intel.rss_fetcher import fetch_all
from news_intel.normalizer import normalize_batch
from news_intel.verifier import verify
from news_intel.summarizer import summarize_all
from news_intel.formatter import format_briefing, select_top_clusters
from news_intel.emailer import send_briefing
from news_intel.priority import prioritize
from news_intel.sentiment import save_today as save_sentiment, format_sentiment_section
from news_intel.threading import thread_clusters

OUTPUT_DIR = Path(__file__).parent / "output"
MAX_AGE_HOURS = 36  # primary window: yesterday's news + buffer
CONTEXT_AGE_DAYS = 7  # wider window for "major this week" context


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def _build_json_output(clusters, source_count: int) -> str:
    """Build structured JSON output for OpenClaw consumption."""
    from news_intel.config import SECTION_ORDER

    now = datetime.now(timezone.utc)
    sections_map = {cat: [] for cat in SECTION_ORDER}
    for c in clusters:
        if c.category in sections_map:
            sections_map[c.category].append(c)

    sections = []
    top_story = None
    for cat in SECTION_ORDER:
        cat_clusters = sections_map.get(cat, [])
        if not cat_clusters:
            continue
        stories = []
        for cluster in cat_clusters:
            summary = getattr(cluster, "ai_summary", None)
            if not summary:
                rep = cluster.representative
                summary = rep.summary if rep else cluster.headline
            story = {
                "headline": cluster.headline,
                "summary": summary,
                "sources": sorted({a.publisher for a in cluster.articles}),
                "source_count": cluster.distinct_publishers,
                "verification": cluster.label,
                "published": cluster.newest.isoformat() if cluster.newest else None,
                "thread_label": getattr(cluster, "thread_label", ""),
                "links": [
                    {"publisher": a.publisher, "url": a.link}
                    for a in cluster.articles if a.link
                ][:5],
            }
            stories.append(story)
            if top_story is None or cluster.distinct_publishers > top_story.get("source_count", 0):
                top_story = story
        sections.append({"category": cat, "stories": stories})

    sentiment_data = {}
    try:
        from news_intel import summarizer
        for cat, score in summarizer.sentiment_scores.items():
            sentiment_data[cat] = {
                "score": score,
                "note": summarizer.sentiment_notes.get(cat, ""),
            }
    except Exception:
        pass

    big_this_week = ""
    on_the_radar = ""
    try:
        from news_intel import summarizer as summ
        big_this_week = summ.big_this_week or ""
        on_the_radar = summ.on_the_radar or ""
    except Exception:
        pass

    output = {
        "date": now.strftime("%Y-%m-%d"),
        "generated_at": now.isoformat(),
        "source_count": source_count,
        "story_count": sum(len(s["stories"]) for s in sections),
        "sections": sections,
        "top_story": top_story,
        "sentiment_trend": sentiment_data,
        "big_this_week": big_this_week,
        "on_the_radar": on_the_radar,
    }
    return json.dumps(output, indent=2, default=str)


def run_pipeline(
    dry_run: bool = False,
    category_filter: str | None = None,
    verbose: bool = False,
    send_email: bool = True,
    output_json: bool = False,
    preferences_file: Optional[str] = None,
) -> str:
    setup_logging(verbose)
    logger = logging.getLogger("main")

    # ── 1. Source selection ───────────────────────────────────────────────
    sources = SOURCES
    if category_filter:
        sources = [s for s in SOURCES if category_filter.lower() in s.category.lower()]
        if not sources:
            logger.error("No sources match category filter: %s", category_filter)
            sys.exit(1)
    logger.info("Starting pipeline with %d sources", len(sources))

    # ── 2. Fetch ─────────────────────────────────────────────────────────
    logger.info("═══ PHASE 1: RSS Ingestion ═══")
    raw_articles = fetch_all(sources)
    if not raw_articles:
        logger.error("No articles fetched. Check network and feed URLs.")
        sys.exit(1)

    # ── 3. Filter articles into fresh (last 36h) and context (last 7d) ──
    now = datetime.now(timezone.utc)
    fresh_cutoff = now - timedelta(hours=MAX_AGE_HOURS)
    context_cutoff = now - timedelta(days=CONTEXT_AGE_DAYS)

    before = len(raw_articles)
    fresh_articles = [
        a for a in raw_articles
        if a.published is None or a.published >= fresh_cutoff
    ]
    context_articles = [
        a for a in raw_articles
        if a.published and context_cutoff <= a.published < fresh_cutoff
    ]
    dropped = before - len(fresh_articles) - len(context_articles)
    logger.info(
        "Articles: %d fresh (last %dh), %d context (last %dd), %d dropped as stale",
        len(fresh_articles), MAX_AGE_HOURS, len(context_articles), CONTEXT_AGE_DAYS, dropped,
    )
    raw_articles = fresh_articles

    # ── 4. Normalize ─────────────────────────────────────────────────────
    logger.info("═══ PHASE 2: Normalization ═══")
    articles = normalize_batch(raw_articles)

    context_normalized = normalize_batch(context_articles) if context_articles else []

    # ── 5. Verify / Cluster ──────────────────────────────────────────────
    logger.info("═══ PHASE 3: Verification ═══")
    clusters = verify(articles)

    # ── 6. Sync preferences from OpenClaw if provided ─────────────────
    if preferences_file:
        logger.info("═══ PHASE 3a: Syncing OpenClaw Preferences ═══")
        try:
            from preferences_updater import sync_from_openclaw
            sync_from_openclaw(preferences_file)
            logger.info("Preferences synced from %s", preferences_file)
        except Exception as exc:
            logger.warning("Could not sync OpenClaw preferences: %s", exc)

    # ── 6. Prioritize by user preferences ───────────────────────────────
    logger.info("═══ PHASE 3b: Priority Scoring ═══")
    clusters = prioritize(clusters)

    # ── 7. Select top stories per section (before AI, to save API calls) ─
    clusters = select_top_clusters(clusters)

    # ── 8. Summarize ─────────────────────────────────────────────────────
    if dry_run:
        logger.info("Dry-run mode — skipping AI summarization")
    else:
        logger.info("═══ PHASE 4: AI Summarization ═══")
        clusters = summarize_all(clusters, context_articles=context_normalized)

    # ── 9. Topic threading (link stories across days) ─────────────────────
    logger.info("═══ PHASE 4b: Topic Threading ═══")
    clusters = thread_clusters(clusters)

    # ── 10. Save sentiment data ───────────────────────────────────────────
    if not dry_run:
        from news_intel import summarizer
        if summarizer.sentiment_scores:
            save_sentiment(summarizer.sentiment_scores, summarizer.sentiment_notes)

    # ── 10b. Intelligence Layer (additive, behind feature flag) ────────────
    intelligence_html = ""
    intelligence_text = ""
    try:
        from news_intel.intelligence import run_intelligence_layer
        report = run_intelligence_layer(clusters, dry_run=dry_run)
        if report:
            intelligence_html = report.html
            intelligence_text = report.text
            if report.errors:
                logger.warning("Intelligence layer had %d non-fatal errors", len(report.errors))
    except Exception as exc:
        logger.warning("Intelligence layer failed (falling back to original): %s", exc)

    # ── 11. JSON output path (for OpenClaw) ─────────────────────────────
    if output_json:
        logger.info("═══ PHASE 5: JSON Output ═══")
        json_content = _build_json_output(clusters, source_count=len(sources))
        OUTPUT_DIR.mkdir(exist_ok=True)
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        json_path = OUTPUT_DIR / f"briefing_{date_str}.json"
        json_path.write_text(json_content, encoding="utf-8")
        logger.info("JSON briefing written to %s (%d chars)", json_path, len(json_content))
        return json_content

    # ── 11. Format ────────────────────────────────────────────────────────
    logger.info("═══ PHASE 5: Formatting ═══")
    html_content, text_content = format_briefing(
        clusters,
        source_count=len(sources),
        intelligence_html=intelligence_html,
        intelligence_text=intelligence_text,
    )

    # ── 12. Output ────────────────────────────────────────────────────────
    OUTPUT_DIR.mkdir(exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    html_path = OUTPUT_DIR / f"briefing_{date_str}.html"
    html_path.write_text(html_content, encoding="utf-8")

    text_path = OUTPUT_DIR / f"briefing_{date_str}.txt"
    text_path.write_text(text_content, encoding="utf-8")

    logger.info("Briefing written to %s (HTML: %d chars, text: %d chars)", OUTPUT_DIR, len(html_content), len(text_content))

    # ── 13. Email ─────────────────────────────────────────────────────────
    if send_email and not dry_run:
        logger.info("═══ PHASE 6: Email Delivery ═══")
        if send_briefing(html_content, text_content):
            logger.info("Email sent successfully")
        else:
            logger.warning("Email delivery failed — briefing still saved to %s", OUTPUT_DIR)
    elif dry_run:
        logger.info("Dry-run mode — skipping email delivery")
    else:
        logger.info("Email delivery disabled via --no-email")

    return text_content


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Daily News Intelligence Briefing Generator"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip AI summarization (useful for testing feed ingestion)",
    )
    parser.add_argument(
        "--category",
        type=str,
        default=None,
        help="Filter to a specific category (e.g. 'Crypto', 'AI')",
    )
    parser.add_argument(
        "--no-email",
        action="store_true",
        help="Skip email delivery (still saves to output/)",
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Output structured JSON instead of HTML (for OpenClaw integration)",
    )
    parser.add_argument(
        "--preferences-file",
        type=str,
        default=None,
        help="Path to OpenClaw user_preferences.json to sync before running",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging",
    )
    args = parser.parse_args()

    briefing = run_pipeline(
        dry_run=args.dry_run,
        category_filter=args.category,
        verbose=args.verbose,
        send_email=not args.no_email,
        output_json=args.output_json,
        preferences_file=args.preferences_file,
    )
    print(briefing)


if __name__ == "__main__":
    main()

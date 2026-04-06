"""
AI Insight Engine (Layer 4).

The central LLM-powered module that converts raw signals and clusters into:
- One-sentence daily summary
- "What this means" / "Why it matters" / "What could happen next"
- Opportunity identification

Uses a SINGLE batched OpenAI call to minimize cost.
Results are cached to avoid redundant calls.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from news_intel.verifier import StoryCluster
from news_intel.intelligence.signal_extractor import Signal
from news_intel.intelligence.config import (
    INTELLIGENCE_MODEL,
    INTELLIGENCE_TEMPERATURE,
    INTELLIGENCE_MAX_TOKENS,
    CACHE_DIR_NAME,
    CACHE_TTL_HOURS,
)

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent.parent / "data" / CACHE_DIR_NAME


@dataclass
class Insight:
    summary: str
    implications: List[str] = field(default_factory=list)
    risk_scenarios: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "implications": self.implications,
            "risk_scenarios": self.risk_scenarios,
        }


SYSTEM_PROMPT = """\
You are a senior intelligence analyst producing a daily strategic briefing.

Your task is to synthesize news signals into actionable intelligence.

RULES:
1. Be precise, clinical, and direct. No filler.
2. Focus on CHANGES — what shifted, not what stayed the same.
3. Every implication must be concrete and specific.
4. Risk scenarios should describe the mechanism, not just the outcome.
5. Opportunities should be actionable within days/weeks, not vague.
6. Write as if briefing a decision-maker who has 2 minutes.

OUTPUT FORMAT (strict JSON):
{
  "one_sentence": "Single sentence capturing today's most important development",
  "insight": {
    "summary": "2-3 sentence synthesis of what the signals collectively mean",
    "implications": ["implication 1", "implication 2", ...],
    "risk_scenarios": ["scenario 1", "scenario 2", ...]
  },
  "opportunities": ["opportunity 1", "opportunity 2", ...]
}

Return ONLY valid JSON. No markdown fencing.
"""


def _build_prompt(
    signals: List[Signal],
    clusters: List[StoryCluster],
) -> str:
    """Build the user prompt from signals and cluster context."""
    parts: List[str] = []

    parts.append(f"=== TODAY'S SIGNALS ({len(signals)} detected) ===\n")
    for i, sig in enumerate(signals[:20]):
        parts.append(
            f"{i+1}. [{sig.type.upper()}] {sig.title} "
            f"(direction: {sig.direction}, confidence: {sig.confidence}, "
            f"sources: {sig.sources_count})"
        )
        if sig.drivers:
            parts.append(f"   Drivers: {', '.join(sig.drivers[:3])}")

    parts.append(f"\n=== TOP STORIES ({len(clusters)} clusters) ===\n")
    for cluster in clusters[:15]:
        sources = ", ".join(sorted(set(cluster.publishers))[:4])
        parts.append(f"• [{cluster.category}] {cluster.headline}")
        parts.append(f"  Status: {cluster.label} | Sources: {sources}")
        summary = getattr(cluster, "ai_summary", None)
        if summary:
            parts.append(f"  Summary: {summary[:200]}")

    parts.append(
        "\nProduce the JSON with 'one_sentence', 'insight' "
        "(summary, implications, risk_scenarios), and 'opportunities'."
    )
    return "\n".join(parts)


def _cache_key(prompt: str) -> str:
    """Generate a deterministic cache key from the prompt content."""
    return hashlib.sha256(prompt.encode()).hexdigest()[:24]


def _read_cache(key: str) -> Optional[dict]:
    """Read cached result if it exists and hasn't expired."""
    cache_file = CACHE_DIR / f"{key}.json"
    if not cache_file.exists():
        return None
    try:
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        cached_at = datetime.fromisoformat(data.get("_cached_at", ""))
        age_hours = (datetime.now(timezone.utc) - cached_at).total_seconds() / 3600
        if age_hours > CACHE_TTL_HOURS:
            logger.info("Cache expired (%.1fh old)", age_hours)
            return None
        logger.info("Cache hit for intelligence analysis")
        return data
    except Exception:
        return None


def _write_cache(key: str, data: dict) -> None:
    """Write result to cache."""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        data["_cached_at"] = datetime.now(timezone.utc).isoformat()
        (CACHE_DIR / f"{key}.json").write_text(
            json.dumps(data, indent=2), encoding="utf-8"
        )
    except Exception as exc:
        logger.warning("Failed to write cache: %s", exc)


def _call_openai(system: str, user: str) -> Optional[str]:
    """Make the OpenAI API call."""
    try:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        response = client.chat.completions.create(
            model=INTELLIGENCE_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=INTELLIGENCE_TEMPERATURE,
            max_tokens=INTELLIGENCE_MAX_TOKENS,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        logger.error("Intelligence OpenAI call failed: %s", exc)
        return None


def _parse_response(raw: str) -> dict:
    """Parse the JSON response, handling markdown fencing."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Failed to parse intelligence JSON")
        return {}


def _fallback_insight(signals: List[Signal], clusters: List[StoryCluster]) -> dict:
    """Generate a basic insight when the LLM is unavailable."""
    top_signals = signals[:3]
    if top_signals:
        summary = "Key developments: " + "; ".join(s.title for s in top_signals)
    elif clusters:
        summary = "Key developments: " + "; ".join(c.headline for c in clusters[:3])
    else:
        summary = "Insufficient data for intelligence synthesis"

    return {
        "one_sentence": summary[:200],
        "insight": {
            "summary": summary,
            "implications": ["Insufficient data for AI-powered implications — review signals manually"],
            "risk_scenarios": ["LLM unavailable — manual risk assessment recommended"],
        },
        "opportunities": ["Review raw signals for potential opportunities"],
    }


def generate_insights(
    signals: List[Signal],
    clusters: List[StoryCluster],
) -> tuple[str, Insight, List[str]]:
    """
    Main entry point: generate the intelligence analysis.

    Returns:
        (one_sentence, insight, opportunities)
    """
    prompt = _build_prompt(signals, clusters)
    cache_key = _cache_key(prompt)

    cached = _read_cache(cache_key)
    if cached:
        parsed = cached
    else:
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key or api_key.startswith("sk-your"):
            logger.info("No valid OpenAI key — using fallback insights")
            parsed = _fallback_insight(signals, clusters)
        else:
            logger.info("Generating intelligence analysis via %s (%d chars prompt)",
                        INTELLIGENCE_MODEL, len(prompt))
            raw = _call_openai(SYSTEM_PROMPT, prompt)
            if raw:
                parsed = _parse_response(raw)
                if parsed:
                    _write_cache(cache_key, parsed)
            else:
                parsed = _fallback_insight(signals, clusters)

    one_sentence = parsed.get("one_sentence", "No summary available")
    insight_data = parsed.get("insight", {})
    insight = Insight(
        summary=insight_data.get("summary", "Analysis unavailable"),
        implications=insight_data.get("implications", []),
        risk_scenarios=insight_data.get("risk_scenarios", []),
    )
    opportunities = parsed.get("opportunities", [])

    logger.info(
        "Intelligence analysis: %d implications, %d risk scenarios, %d opportunities",
        len(insight.implications), len(insight.risk_scenarios), len(opportunities),
    )
    return one_sentence, insight, opportunities

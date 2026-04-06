"""
Opportunity Radar.

Structures raw opportunity strings from the insight engine into
categorized, actionable items. Acts as a thin post-processing layer.

If the insight engine produced opportunities, those are used.
Otherwise, generates rule-based fallback opportunities from signals.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List

from news_intel.intelligence.signal_extractor import Signal

logger = logging.getLogger(__name__)

OPPORTUNITY_CATEGORIES = {
    "trading": ["volatility", "trading", "short", "long", "hedge", "position", "spread"],
    "business": ["demand", "market gap", "build", "launch", "growing", "opportunity"],
    "tech": ["ai", "tool", "platform", "automation", "developer", "infrastructure"],
}


def _categorize(opportunity: str) -> str:
    """Assign a rough category to an opportunity string."""
    lower = opportunity.lower()
    for cat, keywords in OPPORTUNITY_CATEGORIES.items():
        if any(kw in lower for kw in keywords):
            return cat
    return "general"


def _generate_fallback_opportunities(signals: List[Signal]) -> List[str]:
    """Generate basic opportunities when LLM is unavailable."""
    opportunities: List[str] = []

    market_signals = [s for s in signals if s.type == "market"]
    for sig in market_signals[:3]:
        if sig.direction in ("up", "down"):
            opportunities.append(
                f"{sig.title} — volatility creates potential trading setups"
            )

    geo_signals = [s for s in signals if s.type == "geopolitical"]
    for sig in geo_signals[:2]:
        if sig.direction == "escalation":
            opportunities.append(
                "Geopolitical tension rise — defense and energy sectors may benefit"
            )
            break
        elif sig.direction == "de-escalation":
            opportunities.append(
                "Geopolitical de-escalation — risk assets and travel sectors may rally"
            )
            break

    tech_signals = [s for s in signals if s.type == "corporate"]
    for sig in tech_signals[:2]:
        if any(kw in sig.title.lower() for kw in ["ai", "tech", "launch"]):
            opportunities.append(
                f"Corporate activity in tech sector — watch for derivative opportunities"
            )
            break

    return opportunities or ["Review today's signals for emerging opportunities"]


def compile_opportunities(
    llm_opportunities: List[str],
    signals: List[Signal],
) -> List[str]:
    """
    Main entry point: produce the final opportunity list.

    Uses LLM-generated opportunities if available, otherwise falls back
    to rule-based generation from signals.
    """
    if llm_opportunities:
        result = llm_opportunities[:8]
    else:
        result = _generate_fallback_opportunities(signals)

    logger.info("Compiled %d opportunities", len(result))
    return result

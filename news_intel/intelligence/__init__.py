"""
Intelligence Layer Orchestrator.

Runs all intelligence modules on top of existing pipeline output.
Each module is independently wrapped in error handling — a failure
in any single module does not affect the others or the original pipeline.

Usage:
    from news_intel.intelligence import run_intelligence_layer
    report = run_intelligence_layer(clusters)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

from news_intel.verifier import StoryCluster
import news_intel.intelligence.config as intel_config
from news_intel.intelligence.signal_extractor import Signal, extract_signals
from news_intel.intelligence.insight_engine import Insight, generate_insights
from news_intel.intelligence.blindspot_detector import detect_blindspots
from news_intel.intelligence.power_nodes import PowerNode, track_power_nodes
from news_intel.intelligence.contrarian import ContrarianAlert, analyze_contrarian
from news_intel.intelligence.opportunity_radar import compile_opportunities
from news_intel.intelligence.enhanced_formatter import (
    format_intelligence_html,
    format_intelligence_text,
)

logger = logging.getLogger(__name__)


@dataclass
class IntelligenceReport:
    """Aggregated output from all intelligence modules."""
    one_sentence: str = ""
    signals: List[Signal] = field(default_factory=list)
    insight: Insight = field(default_factory=lambda: Insight(summary="", implications=[], risk_scenarios=[]))
    blindspots: List[str] = field(default_factory=list)
    power_nodes: List[PowerNode] = field(default_factory=list)
    contrarian: List[ContrarianAlert] = field(default_factory=list)
    opportunities: List[str] = field(default_factory=list)
    generated_at: str = ""
    html: str = ""
    text: str = ""
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "one_sentence": self.one_sentence,
            "signals": [s.to_dict() for s in self.signals],
            "insight": self.insight.to_dict(),
            "blindspots": self.blindspots,
            "power_nodes": [n.to_dict() for n in self.power_nodes],
            "contrarian": [c.to_dict() for c in self.contrarian],
            "opportunities": self.opportunities,
            "generated_at": self.generated_at,
            "errors": self.errors,
        }


def run_intelligence_layer(
    clusters: List[StoryCluster],
    dry_run: bool = False,
) -> Optional[IntelligenceReport]:
    """
    Run the full intelligence pipeline on top of existing cluster data.

    Returns an IntelligenceReport with formatted HTML/text ready for
    injection into the briefing, or None if the layer is disabled.

    Guarantees:
    - Never raises exceptions (all errors caught and logged)
    - Original clusters are not modified
    - Returns None if ENABLE_INTELLIGENCE_LAYER is False
    """
    if not intel_config.ENABLE_INTELLIGENCE_LAYER:
        logger.info("Intelligence layer disabled via config")
        return None

    if not clusters:
        logger.warning("No clusters provided to intelligence layer")
        return None

    logger.info("═══ INTELLIGENCE LAYER: Starting analysis on %d clusters ═══", len(clusters))
    report = IntelligenceReport(
        generated_at=datetime.now(timezone.utc).isoformat(),
    )

    # ── 1. Signal Extraction (rule-based, fast) ──────────────────────────
    if intel_config.ENABLE_SIGNAL_EXTRACTION:
        try:
            report.signals = extract_signals(clusters)
            logger.info("Signal extraction: %d signals", len(report.signals))
        except Exception as exc:
            msg = f"Signal extraction failed: {exc}"
            logger.error(msg)
            report.errors.append(msg)

    # ── 2. Blindspot Detection (rule-based, fast) ────────────────────────
    if intel_config.ENABLE_BLINDSPOT_DETECTION:
        try:
            report.blindspots = detect_blindspots(clusters)
            logger.info("Blindspot detection: %d gaps", len(report.blindspots))
        except Exception as exc:
            msg = f"Blindspot detection failed: {exc}"
            logger.error(msg)
            report.errors.append(msg)

    # ── 3. Power Node Tracking (rule-based, fast) ────────────────────────
    if intel_config.ENABLE_POWER_NODE_TRACKING:
        try:
            report.power_nodes = track_power_nodes(clusters)
            logger.info("Power node tracking: %d active nodes", len(report.power_nodes))
        except Exception as exc:
            msg = f"Power node tracking failed: {exc}"
            logger.error(msg)
            report.errors.append(msg)

    # ── 4. Contrarian Analysis (rule-based, uses signals) ────────────────
    if intel_config.ENABLE_CONTRARIAN_ANALYSIS:
        try:
            report.contrarian = analyze_contrarian(report.signals, clusters)
            logger.info("Contrarian analysis: %d alerts", len(report.contrarian))
        except Exception as exc:
            msg = f"Contrarian analysis failed: {exc}"
            logger.error(msg)
            report.errors.append(msg)

    # ── 5. Insight Engine (LLM-powered, skip on dry-run) ─────────────────
    llm_opportunities: List[str] = []
    if intel_config.ENABLE_INSIGHT_ENGINE and not dry_run:
        try:
            one_sentence, insight, llm_opps = generate_insights(
                report.signals, clusters
            )
            report.one_sentence = one_sentence
            report.insight = insight
            llm_opportunities = llm_opps
            logger.info("Insight engine: generated analysis")
        except Exception as exc:
            msg = f"Insight engine failed: {exc}"
            logger.error(msg)
            report.errors.append(msg)
    elif dry_run:
        logger.info("Insight engine skipped (dry-run mode)")
        report.one_sentence = "Dry-run mode — AI analysis skipped"

    # ── 6. Opportunity Radar (uses LLM output + signals) ─────────────────
    if intel_config.ENABLE_OPPORTUNITY_RADAR:
        try:
            report.opportunities = compile_opportunities(llm_opportunities, report.signals)
            logger.info("Opportunity radar: %d opportunities", len(report.opportunities))
        except Exception as exc:
            msg = f"Opportunity radar failed: {exc}"
            logger.error(msg)
            report.errors.append(msg)

    # ── 7. Format Output ─────────────────────────────────────────────────
    try:
        report.html = format_intelligence_html(
            one_sentence=report.one_sentence,
            signals=report.signals,
            insight=report.insight,
            contrarian=report.contrarian,
            blindspots=report.blindspots,
            power_nodes=report.power_nodes,
            opportunities=report.opportunities,
        )
        report.text = format_intelligence_text(
            one_sentence=report.one_sentence,
            signals=report.signals,
            insight=report.insight,
            contrarian=report.contrarian,
            blindspots=report.blindspots,
            power_nodes=report.power_nodes,
            opportunities=report.opportunities,
        )
        logger.info("Formatted intelligence output: HTML=%d chars, text=%d chars",
                     len(report.html), len(report.text))
    except Exception as exc:
        msg = f"Intelligence formatting failed: {exc}"
        logger.error(msg)
        report.errors.append(msg)

    if report.errors:
        logger.warning("Intelligence layer completed with %d errors: %s",
                        len(report.errors), report.errors)
    else:
        logger.info("═══ INTELLIGENCE LAYER: Complete ═══")

    return report

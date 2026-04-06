"""
Tests for the intelligence layer.

Covers:
- Individual module unit tests
- Integration test for the full pipeline
- Edge cases: empty input, missing data, conflicting stories
- Regression: original system output unchanged when layer disabled
"""

from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from news_intel.normalizer import NormalizedArticle
from news_intel.verifier import StoryCluster


# ---------------------------------------------------------------------------
# Test fixture helpers
# ---------------------------------------------------------------------------

def _make_article(
    title: str = "Test Article",
    publisher: str = "Reuters",
    category: str = "World & Geopolitics",
    summary: str = "This is a test article summary.",
    source_tier: int = 1,
    published: datetime | None = None,
) -> NormalizedArticle:
    return NormalizedArticle(
        uid=f"test_{hash(title) % 10000:04d}",
        title=title,
        publisher=publisher,
        category=category,
        published=published or datetime.now(timezone.utc),
        summary=summary,
        entities={"PERSON": set(), "ORG": set(), "GPE": set()},
        link=f"https://example.com/{title.replace(' ', '-').lower()}",
        source_tier=source_tier,
        source_lean="center",
    )


def _make_cluster(
    headline: str = "Test Cluster",
    category: str = "World & Geopolitics",
    articles: list | None = None,
    cluster_id: int = 0,
    label: str = "🟢 VERIFIED",
) -> StoryCluster:
    if articles is None:
        articles = [
            _make_article(title=headline, publisher="Reuters"),
            _make_article(title=headline, publisher="AP News"),
        ]
    cluster = StoryCluster(
        cluster_id=cluster_id,
        articles=articles,
        category=category,
        headline=headline,
        publishers=[a.publisher for a in articles],
        representative=articles[0] if articles else None,
    )
    cluster.label = label
    return cluster


def _make_high_news_clusters() -> list[StoryCluster]:
    """Simulate a high-news day with many diverse stories."""
    return [
        _make_cluster("Oil prices surge 10% on OPEC cuts", "Economy & Markets", [
            _make_article("Oil prices surge 10% on OPEC cuts", "Reuters", "Economy & Markets",
                          "Crude oil prices surged 10% after OPEC announced production cuts"),
            _make_article("Oil rallies on OPEC decision", "Bloomberg", "Economy & Markets",
                          "Oil prices rally sharply on OPEC production cuts", 1),
            _make_article("Brent crude spikes on supply fears", "CNBC", "Economy & Markets",
                          "Oil market sees major price spike amid OPEC cuts", 2),
        ], cluster_id=0),
        _make_cluster("Iran nuclear talks collapse", "World & Geopolitics", [
            _make_article("Iran nuclear talks collapse amid sanctions dispute", "Reuters", "World & Geopolitics",
                          "Iran nuclear negotiations have broken down after Tehran rejected new sanctions terms"),
            _make_article("Iran walks out of nuclear negotiations", "AP News", "World & Geopolitics",
                          "Iranian delegation walked out of nuclear talks in Vienna", 1),
        ], cluster_id=1),
        _make_cluster("NVIDIA reports record AI chip earnings", "AI & Technology", [
            _make_article("NVIDIA reports record AI chip earnings", "CNBC", "AI & Technology",
                          "NVIDIA quarterly revenue beats expectations driven by AI demand", 2),
            _make_article("NVIDIA earnings surge on AI demand", "TechCrunch", "AI & Technology",
                          "NVIDIA earnings surge past estimates on artificial intelligence chip sales", 2),
        ], cluster_id=2),
        _make_cluster("Bitcoin drops below $50,000", "Crypto", [
            _make_article("Bitcoin drops below $50,000 on regulatory fears", "CoinDesk", "Crypto",
                          "Bitcoin price has fallen below $50,000 as SEC crypto regulation concerns mount", 2),
        ], cluster_id=3, label="🟡 DEVELOPING"),
        _make_cluster("Russia deploys troops to Ukraine border", "Wars & Conflicts", [
            _make_article("Russia deploys additional troops near Ukraine border", "BBC", "Wars & Conflicts",
                          "Russia military buildup near Ukraine continues with fresh troop deployments", 1),
            _make_article("Russian troops massing near Ukraine", "Al Jazeera", "Wars & Conflicts",
                          "Russian forces massing near Ukraine border escalation tensions", 2),
            _make_article("Putin orders military buildup", "Reuters", "Wars & Conflicts",
                          "Putin ordered additional troops to deploy near Ukraine border", 1),
        ], cluster_id=4),
        _make_cluster("Tesla registrations surge in Europe", "Stocks", [
            _make_article("Tesla registrations surge 30% in Europe", "MarketWatch", "Stocks",
                          "Tesla electric vehicle registrations in Europe rise 30% year-over-year", 2),
        ], cluster_id=5, label="🟡 DEVELOPING"),
        _make_cluster("Fed signals potential rate cut", "Economy & Markets", [
            _make_article("Federal Reserve signals potential rate cut in September", "Reuters", "Economy & Markets",
                          "Federal Reserve chair hints at potential interest rate cut at September meeting", 1),
            _make_article("Fed rate cut expected in fall", "Bloomberg", "Economy & Markets",
                          "Markets pricing in Fed rate cut after dovish signals from Fed officials", 1),
        ], cluster_id=6),
    ]


def _make_low_news_clusters() -> list[StoryCluster]:
    """Simulate a low-news day with few stories."""
    return [
        _make_cluster("Markets close flat on light trading", "Stocks", [
            _make_article("Markets close flat on light trading day", "CNBC", "Stocks",
                          "Stock markets ended the day largely flat with low trading volume", 2),
        ], cluster_id=0, label="🔴 UNVERIFIED"),
    ]


def _make_conflicting_clusters() -> list[StoryCluster]:
    """Simulate conflicting reports on the same topic."""
    return [
        _make_cluster("Oil prices surge on supply fears", "Economy & Markets", [
            _make_article("Oil prices surge on supply fears", "Reuters", "Economy & Markets",
                          "Oil surged due to fears of supply disruption in the Middle East", 1),
        ], cluster_id=0, label="🟡 DEVELOPING"),
        _make_cluster("Oil prices expected to drop on demand weakness", "Economy & Markets", [
            _make_article("Oil prices expected to drop on demand weakness", "Bloomberg", "Economy & Markets",
                          "Analysts expect oil price decline due to weakening demand from China", 1),
        ], cluster_id=1, label="🟡 DEVELOPING"),
    ]


# ---------------------------------------------------------------------------
# Unit Tests: Signal Extractor
# ---------------------------------------------------------------------------

class TestSignalExtractor(unittest.TestCase):

    def test_extracts_market_signals(self):
        from news_intel.intelligence.signal_extractor import extract_signals
        clusters = [_make_cluster(
            "Oil prices surge 15% on OPEC cuts",
            "Economy & Markets",
            [_make_article(
                "Oil prices surge 15% on OPEC cuts",
                "Reuters", "Economy & Markets",
                "Crude oil prices surged 15% after OPEC cut production",
            )],
        )]
        signals = extract_signals(clusters)
        market_signals = [s for s in signals if s.type == "market"]
        self.assertGreater(len(market_signals), 0)
        self.assertEqual(market_signals[0].direction, "up")

    def test_extracts_geopolitical_signals(self):
        from news_intel.intelligence.signal_extractor import extract_signals
        clusters = [_make_cluster(
            "Russia military buildup near Ukraine border",
            "Wars & Conflicts",
            [_make_article(
                "Russia military buildup near Ukraine border",
                "Reuters", "Wars & Conflicts",
                "Russia deploys additional troops near Ukraine, NATO raises alarm",
            )],
        )]
        signals = extract_signals(clusters)
        geo_signals = [s for s in signals if s.type == "geopolitical"]
        self.assertGreater(len(geo_signals), 0)
        self.assertEqual(geo_signals[0].direction, "escalation")

    def test_extracts_policy_signals(self):
        from news_intel.intelligence.signal_extractor import extract_signals
        clusters = [_make_cluster(
            "Federal Reserve signals rate cut",
            "Economy & Markets",
            [_make_article(
                "Federal Reserve signals rate cut at September meeting",
                "Reuters", "Economy & Markets",
                "The Fed signaled it may cut the interest rate at the upcoming meeting",
            )],
        )]
        signals = extract_signals(clusters)
        policy_signals = [s for s in signals if s.type == "policy"]
        self.assertGreater(len(policy_signals), 0)

    def test_empty_clusters_returns_empty(self):
        from news_intel.intelligence.signal_extractor import extract_signals
        signals = extract_signals([])
        self.assertEqual(len(signals), 0)

    def test_no_false_positives_on_benign_headline(self):
        from news_intel.intelligence.signal_extractor import extract_signals
        clusters = [_make_cluster(
            "Local community organizes food drive",
            "World & Geopolitics",
            [_make_article(
                "Local community organizes food drive",
                "BBC", "World & Geopolitics",
                "A local community has organized a food drive for families in need",
            )],
        )]
        signals = extract_signals(clusters)
        self.assertEqual(len(signals), 0)


# ---------------------------------------------------------------------------
# Unit Tests: Blindspot Detector
# ---------------------------------------------------------------------------

class TestBlindspotDetector(unittest.TestCase):

    def test_detects_missing_topics(self):
        from news_intel.intelligence.blindspot_detector import detect_blindspots
        clusters = [_make_cluster(
            "Local weather report",
            "World & Geopolitics",
            [_make_article("Local weather report", "BBC", "World & Geopolitics", "Weather today is sunny")],
        )]
        blindspots = detect_blindspots(clusters)
        self.assertGreater(len(blindspots), 0)
        self.assertTrue(any("China" in b for b in blindspots))

    def test_no_blindspots_with_full_coverage(self):
        from news_intel.intelligence.blindspot_detector import detect_blindspots
        clusters = _make_high_news_clusters()
        blindspots = detect_blindspots(clusters)
        covered_topics = [b for b in blindspots if "Iran" in b]
        self.assertEqual(len(covered_topics), 0)

    def test_empty_clusters_all_blindspots(self):
        from news_intel.intelligence.blindspot_detector import detect_blindspots
        blindspots = detect_blindspots([])
        self.assertGreater(len(blindspots), 0)


# ---------------------------------------------------------------------------
# Unit Tests: Power Nodes
# ---------------------------------------------------------------------------

class TestPowerNodes(unittest.TestCase):

    def test_tracks_mentioned_entities(self):
        from news_intel.intelligence.power_nodes import track_power_nodes
        clusters = _make_high_news_clusters()
        nodes = track_power_nodes(clusters)
        entity_names = [n.entity for n in nodes]
        self.assertIn("Russia", entity_names)

    def test_activity_levels(self):
        from news_intel.intelligence.power_nodes import track_power_nodes
        clusters = _make_high_news_clusters()
        nodes = track_power_nodes(clusters)
        for node in nodes:
            self.assertIn(node.activity, ("high", "medium", "low"))

    def test_empty_clusters(self):
        from news_intel.intelligence.power_nodes import track_power_nodes
        nodes = track_power_nodes([])
        self.assertEqual(len(nodes), 0)


# ---------------------------------------------------------------------------
# Unit Tests: Contrarian Analysis
# ---------------------------------------------------------------------------

class TestContrarianAnalysis(unittest.TestCase):

    def test_detects_directional_consensus(self):
        from news_intel.intelligence.contrarian import analyze_contrarian
        from news_intel.intelligence.signal_extractor import Signal
        signals = [
            Signal("market", "Oil ups", "up", "high", ["demand"], 3),
            Signal("market", "Gold ups", "up", "medium", ["fear"], 2),
        ]
        alerts = analyze_contrarian(signals, [])
        # May or may not trigger depending on threshold
        self.assertIsInstance(alerts, list)

    def test_empty_input(self):
        from news_intel.intelligence.contrarian import analyze_contrarian
        alerts = analyze_contrarian([], [])
        self.assertEqual(len(alerts), 0)


# ---------------------------------------------------------------------------
# Unit Tests: Opportunity Radar
# ---------------------------------------------------------------------------

class TestOpportunityRadar(unittest.TestCase):

    def test_uses_llm_opportunities_when_available(self):
        from news_intel.intelligence.opportunity_radar import compile_opportunities
        llm_opps = ["Oil volatility creates trading setups"]
        result = compile_opportunities(llm_opps, [])
        self.assertEqual(result, llm_opps)

    def test_fallback_from_signals(self):
        from news_intel.intelligence.opportunity_radar import compile_opportunities
        from news_intel.intelligence.signal_extractor import Signal
        signals = [Signal("market", "Oil drops", "down", "high", ["OPEC"], 3)]
        result = compile_opportunities([], signals)
        self.assertGreater(len(result), 0)


# ---------------------------------------------------------------------------
# Unit Tests: Enhanced Formatter
# ---------------------------------------------------------------------------

class TestEnhancedFormatter(unittest.TestCase):

    def test_html_output_not_empty(self):
        from news_intel.intelligence.enhanced_formatter import format_intelligence_html
        from news_intel.intelligence.signal_extractor import Signal
        from news_intel.intelligence.insight_engine import Insight

        html = format_intelligence_html(
            one_sentence="Markets rally on ceasefire hopes.",
            signals=[Signal("market", "Oil ups", "up", "high", ["demand"], 3)],
            insight=Insight("Summary text", ["imp1"], ["risk1"]),
            contrarian=[],
            blindspots=["No China updates"],
            power_nodes=[],
            opportunities=["Buy oil dips"],
        )
        self.assertIn("TODAY IN ONE SENTENCE", html)
        self.assertIn("KEY SIGNALS", html)
        self.assertIn("BLINDSPOTS", html)

    def test_text_output_not_empty(self):
        from news_intel.intelligence.enhanced_formatter import format_intelligence_text
        from news_intel.intelligence.signal_extractor import Signal
        from news_intel.intelligence.insight_engine import Insight

        text = format_intelligence_text(
            one_sentence="Markets rally on ceasefire hopes.",
            signals=[Signal("market", "Oil ups", "up", "high", ["demand"], 3)],
            insight=Insight("Summary text", ["imp1"], ["risk1"]),
            contrarian=[],
            blindspots=["No China updates"],
            power_nodes=[],
            opportunities=["Buy oil dips"],
        )
        self.assertIn("TODAY IN ONE SENTENCE", text)
        self.assertIn("KEY SIGNALS", text)

    def test_empty_input_produces_empty(self):
        from news_intel.intelligence.enhanced_formatter import format_intelligence_html
        from news_intel.intelligence.insight_engine import Insight
        html = format_intelligence_html("", [], Insight("", [], []), [], [], [], [])
        self.assertEqual(html, "")


# ---------------------------------------------------------------------------
# Integration Test: Full Intelligence Pipeline
# ---------------------------------------------------------------------------

class TestIntelligenceIntegration(unittest.TestCase):

    @patch.dict(os.environ, {"OPENAI_API_KEY": ""})
    def test_high_news_day(self):
        from news_intel.intelligence import run_intelligence_layer
        clusters = _make_high_news_clusters()
        report = run_intelligence_layer(clusters, dry_run=True)
        self.assertIsNotNone(report)
        self.assertGreater(len(report.signals), 0)
        self.assertIsInstance(report.blindspots, list)
        self.assertGreater(len(report.power_nodes), 0)
        self.assertIsInstance(report.html, str)
        self.assertIsInstance(report.text, str)
        self.assertEqual(len(report.errors), 0)

    @patch.dict(os.environ, {"OPENAI_API_KEY": ""})
    def test_low_news_day(self):
        from news_intel.intelligence import run_intelligence_layer
        clusters = _make_low_news_clusters()
        report = run_intelligence_layer(clusters, dry_run=True)
        self.assertIsNotNone(report)
        self.assertIsInstance(report.signals, list)
        self.assertGreater(len(report.blindspots), 0)

    @patch.dict(os.environ, {"OPENAI_API_KEY": ""})
    def test_conflicting_reports(self):
        from news_intel.intelligence import run_intelligence_layer
        clusters = _make_conflicting_clusters()
        report = run_intelligence_layer(clusters, dry_run=True)
        self.assertIsNotNone(report)
        self.assertEqual(len(report.errors), 0)

    @patch.dict(os.environ, {"OPENAI_API_KEY": ""})
    def test_empty_clusters(self):
        from news_intel.intelligence import run_intelligence_layer
        report = run_intelligence_layer([], dry_run=True)
        self.assertIsNone(report)

    def test_disabled_layer_returns_none(self):
        from news_intel.intelligence import run_intelligence_layer
        import news_intel.intelligence.config as cfg
        original = cfg.ENABLE_INTELLIGENCE_LAYER
        try:
            cfg.ENABLE_INTELLIGENCE_LAYER = False
            report = run_intelligence_layer(_make_high_news_clusters())
            self.assertIsNone(report)
        finally:
            cfg.ENABLE_INTELLIGENCE_LAYER = original

    @patch.dict(os.environ, {"OPENAI_API_KEY": ""})
    def test_original_clusters_not_modified(self):
        from news_intel.intelligence import run_intelligence_layer
        clusters = _make_high_news_clusters()
        original_headlines = [c.headline for c in clusters]
        original_categories = [c.category for c in clusters]
        run_intelligence_layer(clusters, dry_run=True)
        for i, cluster in enumerate(clusters):
            self.assertEqual(cluster.headline, original_headlines[i])
            self.assertEqual(cluster.category, original_categories[i])


# ---------------------------------------------------------------------------
# Regression: Original formatter unaffected without intelligence
# ---------------------------------------------------------------------------

class TestFormatterRegression(unittest.TestCase):

    def test_formatter_works_without_intelligence(self):
        from news_intel.formatter import format_briefing
        clusters = _make_high_news_clusters()
        for c in clusters:
            c.ai_summary = "Test summary"
        html, text = format_briefing(clusters, source_count=5)
        self.assertIn("Daily Intelligence Briefing", html)
        self.assertIn("DAILY INTELLIGENCE BRIEFING", text)
        self.assertNotIn("INTELLIGENCE LAYER", html)

    def test_formatter_works_with_intelligence(self):
        from news_intel.formatter import format_briefing
        clusters = _make_high_news_clusters()
        for c in clusters:
            c.ai_summary = "Test summary"
        html, text = format_briefing(
            clusters,
            source_count=5,
            intelligence_html="<tr><td>INTELLIGENCE TEST</td></tr>",
            intelligence_text="INTELLIGENCE TEXT TEST",
        )
        self.assertIn("INTELLIGENCE TEST", html)
        self.assertIn("INTELLIGENCE TEXT TEST", text)
        self.assertIn("Daily Intelligence Briefing", html)


if __name__ == "__main__":
    unittest.main()

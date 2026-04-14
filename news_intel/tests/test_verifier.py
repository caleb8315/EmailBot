"""
Regression tests for verifier quarantine and promotion logic.

Run: python -m pytest news_intel/tests/test_verifier.py -v
  or: python news_intel/tests/test_verifier.py
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent))

from news_intel.normalizer import NormalizedArticle
from news_intel.verifier import (
    LABEL_VERIFIED,
    LABEL_DEVELOPING,
    LABEL_QUARANTINED,
    verify,
    recheck_quarantined,
)


def _make_article(
    uid: str,
    title: str,
    publisher: str,
    tier: int = 1,
    category: str = "World & Geopolitics",
) -> NormalizedArticle:
    return NormalizedArticle(
        uid=uid,
        title=title,
        publisher=publisher,
        category=category,
        published=datetime.now(timezone.utc),
        summary=title,
        entities={"PERSON": set(), "ORG": set(), "GPE": set()},
        link=f"https://example.com/{uid}",
        source_tier=tier,
        source_lean="center",
    )


passed = 0
failed = 0


def assert_eq(actual, expected, name):
    global passed, failed
    if actual == expected:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name} — expected {expected!r}, got {actual!r}")


def test_single_source_quarantined():
    """Single-source articles should be quarantined, not verified."""
    articles = [
        _make_article("a1", "New policy threatens rights in state", "SomePublisher", tier=3),
    ]
    clusters = verify(articles)
    assert_eq(len(clusters), 1, "single cluster created")
    assert_eq(clusters[0].label, LABEL_QUARANTINED, "single source = quarantined")


def test_two_credible_sources_verified():
    """Two credible tier-1 publishers should produce VERIFIED."""
    articles = [
        _make_article("b1", "Major earthquake hits region", "Reuters", tier=1),
        _make_article("b2", "Major earthquake hits region", "AP News", tier=1),
    ]
    clusters = verify(articles)
    assert_eq(len(clusters), 1, "clustered into one")
    assert_eq(clusters[0].label, LABEL_VERIFIED, "two tier-1 = verified")


def test_two_low_tier_developing():
    """Two sources but no credible ones = DEVELOPING."""
    articles = [
        _make_article("c1", "Market crash feared by analysts", "BlogA", tier=3),
        _make_article("c2", "Market crash feared by analysts", "BlogB", tier=3),
    ]
    clusters = verify(articles)
    assert_eq(len(clusters), 1, "clustered")
    assert_eq(clusters[0].label, LABEL_DEVELOPING, "two tier-3 = developing")


def test_alt_category_quarantined():
    """Alternative/conspiracy category should be quarantined unless mainstream corroborates."""
    articles = [
        _make_article(
            "d1", "Secret government program exposed", "Conspiracy News",
            tier=3, category="Conspiracy / Unverified Signals",
        ),
    ]
    clusters = verify(articles)
    assert_eq(clusters[0].label, LABEL_QUARANTINED, "alt single source = quarantined")


def test_quarantine_recheck_promotes():
    """Quarantined clusters should promote when new credible articles arrive."""
    initial_articles = [
        _make_article("e1", "Tensions rise in border region", "SmallOutlet", tier=3),
    ]
    clusters = verify(initial_articles)
    assert_eq(clusters[0].label, LABEL_QUARANTINED, "initially quarantined")

    new_articles = [
        _make_article("e2", "Tensions rise in border region", "Reuters", tier=1),
        _make_article("e3", "Border tensions escalate rapidly", "BBC", tier=1),
    ]
    promoted = recheck_quarantined(clusters, new_articles)
    assert_eq(promoted[0].label, LABEL_VERIFIED, "promoted to verified after recheck")


def test_quarantine_recheck_stays_quarantined():
    """Quarantined clusters stay quarantined when no matching articles arrive."""
    initial_articles = [
        _make_article("f1", "Mysterious lights over Pacific Ocean", "FringeNews", tier=3),
    ]
    clusters = verify(initial_articles)
    assert_eq(clusters[0].label, LABEL_QUARANTINED, "initially quarantined")

    unrelated = [
        _make_article("f2", "Stock markets rally on earnings", "Reuters", tier=1),
    ]
    rechecked = recheck_quarantined(clusters, unrelated)
    assert_eq(rechecked[0].label, LABEL_QUARANTINED, "still quarantined — no matching articles")


if __name__ == "__main__":
    print("\n── Python Verifier Tests ──\n")
    test_single_source_quarantined()
    test_two_credible_sources_verified()
    test_two_low_tier_developing()
    test_alt_category_quarantined()
    test_quarantine_recheck_promotes()
    test_quarantine_recheck_stays_quarantined()

    print(f"\nResults: {passed} passed, {failed} failed")
    if failed > 0:
        sys.exit(1)
    else:
        print("All tests passed.")

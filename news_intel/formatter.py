"""
Email output formatter.

Produces a daily intelligence briefing as:
  - Modern HTML email (primary, for email clients)
  - Plain-text fallback (for terminals / file output)
"""

from __future__ import annotations

import html
import logging
from datetime import datetime, timezone
from typing import Dict, List, Tuple

from news_intel.config import CAT_ALT, SECTION_ORDER
from news_intel.verifier import StoryCluster

logger = logging.getLogger(__name__)

MAX_STORIES_PER_SECTION = 5

SECTION_ICONS = {
    "World & Geopolitics": "🌍",
    "Wars & Conflicts": "⚔️",
    "Economy & Markets": "📊",
    "Stocks": "📈",
    "Crypto": "🪙",
    "AI & Technology": "🤖",
    "Power & Elite Activity": "🏛️",
    "Conspiracy / Unverified Signals": "⚠️",
}

LABEL_COLORS = {
    "🟢 VERIFIED": ("#0d9488", "#f0fdfa", "VERIFIED"),
    "🟡 DEVELOPING": ("#d97706", "#fffbeb", "DEVELOPING"),
    "🔴 UNVERIFIED": ("#dc2626", "#fef2f2", "UNVERIFIED"),
}


def select_top_clusters(clusters: List[StoryCluster]) -> List[StoryCluster]:
    """
    Return only the clusters that will appear in the final briefing
    (top N per section, ranked by source count then recency).
    Call this BEFORE summarization to avoid wasting API calls.
    """
    sections_map: Dict[str, List[StoryCluster]] = {cat: [] for cat in SECTION_ORDER}
    for c in clusters:
        if c.category in sections_map:
            sections_map[c.category].append(c)

    selected: List[StoryCluster] = []
    for cat in SECTION_ORDER:
        cat_clusters = sections_map.get(cat, [])
        cat_clusters.sort(
            key=lambda c: (c.distinct_publishers, c.newest or datetime.min.replace(tzinfo=timezone.utc)),
            reverse=True,
        )
        selected.extend(cat_clusters[:MAX_STORIES_PER_SECTION])

    logger.info("Selected %d top clusters from %d total (max %d per section)", len(selected), len(clusters), MAX_STORIES_PER_SECTION)
    return selected


def _esc(text: str) -> str:
    return html.escape(text)


def _label_badge(label: str) -> str:
    color, bg, text = LABEL_COLORS.get(label, ("#6b7280", "#f9fafb", "UNKNOWN"))
    return (
        f'<span style="display:inline-block;padding:2px 10px;border-radius:12px;'
        f'font-size:11px;font-weight:700;letter-spacing:0.5px;'
        f'color:{color};background:{bg};border:1px solid {color};">'
        f'{text}</span>'
    )


def _format_timestamp(dt: datetime | None) -> str:
    """Human-friendly relative + absolute timestamp."""
    if not dt:
        return "Unknown date"
    now = datetime.now(timezone.utc)
    delta = now - dt
    hours = delta.total_seconds() / 3600

    if hours < 1:
        relative = "Just now"
    elif hours < 24:
        relative = f"{int(hours)}h ago"
    elif hours < 48:
        relative = "Yesterday"
    else:
        relative = f"{int(hours / 24)}d ago"

    absolute = dt.strftime("%b %d, %H:%M UTC")
    return f"{relative} — {absolute}"


def _thread_badge_html(cluster: StoryCluster) -> str:
    """Render a thread indicator badge (NEW, Day X, Escalating, etc)."""
    label = getattr(cluster, "thread_label", "")
    if not label:
        return ""
    if "NEW" in label:
        color, bg = "#059669", "#ecfdf5"
    elif "Escalating" in label:
        color, bg = "#dc2626", "#fef2f2"
    elif "De-escalating" in label:
        color, bg = "#2563eb", "#eff6ff"
    else:
        color, bg = "#6b7280", "#f3f4f6"
    return (
        f'<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:10px;'
        f'font-size:10px;font-weight:600;color:{color};background:{bg};border:1px solid {color};'
        f'vertical-align:middle;">{_esc(label)}</span>'
    )


def _get_sentiment_section_html() -> str:
    """Generate the market mood HTML section."""
    try:
        from news_intel import summarizer
        from news_intel.sentiment import format_sentiment_section
        content = format_sentiment_section(summarizer.sentiment_scores, summarizer.sentiment_notes)
        if not content:
            return ""
        return _insight_box_html("💹", "Market Mood", content, "#0369a1", "#f0f9ff", "#bae6fd")
    except Exception:
        return ""


def _get_source_links(cluster: StoryCluster) -> list[tuple[str, str]]:
    """Get deduplicated (publisher, link) pairs from the cluster's articles."""
    seen: set[str] = set()
    links: list[tuple[str, str]] = []
    for a in cluster.articles:
        if a.link and a.publisher not in seen:
            seen.add(a.publisher)
            links.append((a.publisher, a.link))
    return links[:5]


def _story_html(cluster: StoryCluster) -> str:
    summary = getattr(cluster, "ai_summary", None)
    if not summary:
        rep = cluster.representative
        summary = rep.summary if rep else cluster.headline

    summary_clean = _esc(summary).replace("\n", "<br>")
    timestamp = _format_timestamp(cluster.newest)

    source_links = _get_source_links(cluster)
    sources_html_parts = []
    for pub, link in source_links:
        sources_html_parts.append(
            f'<a href="{_esc(link)}" style="color:#6366f1;text-decoration:none;font-weight:500;" target="_blank">{_esc(pub)}</a>'
        )
    sources_html = " &nbsp;·&nbsp; ".join(sources_html_parts) if sources_html_parts else "—"

    return f"""
    <tr><td style="padding:0 0 20px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="
        background:#ffffff;
        border:1px solid #e5e7eb;
        border-radius:10px;
        overflow:hidden;
      "><tr><td style="padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:16px;font-weight:700;color:#111827;line-height:1.4;">
                {_esc(cluster.headline)}
              </td>
            </tr></table>
          </td>
        </tr><tr>
          <td style="padding:8px 0 10px 0;">
            {_label_badge(cluster.label)}
            {_thread_badge_html(cluster)}
            <span style="display:inline-block;margin-left:8px;font-size:11px;color:#9ca3af;vertical-align:middle;">
              🕐 {_esc(timestamp)}
            </span>
          </td>
        </tr><tr>
          <td style="font-size:14px;color:#374151;line-height:1.65;padding-bottom:12px;">
            {summary_clean}
          </td>
        </tr><tr>
          <td style="font-size:12px;color:#9ca3af;line-height:1.8;">
            <span style="font-weight:600;color:#6b7280;">Read more:</span>&nbsp;&nbsp;{sources_html}
          </td>
        </tr></table>
      </td></tr></table>
    </td></tr>"""


def _section_html(section_name: str, clusters: List[StoryCluster]) -> str:
    icon = SECTION_ICONS.get(section_name, "📰")
    is_alt = section_name == CAT_ALT

    alt_banner = ""
    if is_alt:
        alt_banner = """
        <tr><td style="
          background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;
          padding:10px 16px;margin-bottom:12px;font-size:12px;color:#92400e;line-height:1.5;
        ">
          Items below are <strong>UNVERIFIED</strong> and included for signal monitoring only.
          They do not represent established fact.
        </td></tr>
        <tr><td style="height:12px;"></td></tr>"""

    stories = "".join(_story_html(c) for c in clusters[:MAX_STORIES_PER_SECTION])

    return f"""
    <tr><td style="padding:32px 0 8px 0;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="
          font-size:13px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
          color:#6366f1;padding-bottom:12px;border-bottom:2px solid #e5e7eb;
        ">{icon}&nbsp;&nbsp;{_esc(section_name)}</td>
      </tr></table>
    </td></tr>
    {alt_banner}
    <tr><td style="height:16px;"></td></tr>
    {stories}"""


def _get_summarizer_field(field: str) -> str:
    """Pull big_this_week / on_the_radar from the summarizer module."""
    try:
        from news_intel import summarizer
        val = getattr(summarizer, field, "") or ""
        if isinstance(val, list):
            return "\n".join(str(item) for item in val)
        return str(val)
    except Exception:
        return ""


def _insight_box_html(icon: str, title: str, content: str, color: str, bg: str, border_color: str) -> str:
    """Render a styled insight box (Big This Week / On the Radar)."""
    if not content:
        return ""
    content_html = _esc(content).replace("\n", "<br>")
    return f"""
    <tr><td style="padding:0 0 0 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="
        background:{bg};
        border:1px solid {border_color};
        border-radius:10px;
        border-left:4px solid {color};
        overflow:hidden;
      "><tr><td style="padding:16px 20px;">
        <div style="font-size:14px;font-weight:800;color:{color};margin-bottom:10px;letter-spacing:0.5px;">
          {icon}&nbsp;&nbsp;{_esc(title)}
        </div>
        <div style="font-size:13px;color:#374151;line-height:1.7;">
          {content_html}
        </div>
      </td></tr></table>
    </td></tr>"""


def format_briefing_html(
    clusters: List[StoryCluster],
    source_count: int = 0,
    intelligence_html: str = "",
) -> str:
    now = datetime.now(timezone.utc)
    date_display = now.strftime("%A, %B %d, %Y")
    time_display = now.strftime("%H:%M UTC")

    sections_map: Dict[str, List[StoryCluster]] = {cat: [] for cat in SECTION_ORDER}
    for c in clusters:
        if c.category in sections_map:
            sections_map[c.category].append(c)

    section_blocks = ""
    active_sections = 0
    for section in SECTION_ORDER:
        section_clusters = sections_map.get(section, [])
        if not section_clusters:
            continue
        active_sections += 1
        section_blocks += _section_html(section, section_clusters)

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

        <!-- HEADER -->
        <tr><td style="
          background:linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#4338ca 100%);
          border-radius:16px 16px 0 0;
          padding:36px 32px 28px 32px;
          text-align:center;
        ">
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">
              Daily Intelligence Briefing
            </div>
            <div style="font-size:14px;color:#c7d2fe;margin-top:8px;font-weight:500;">
              {date_display} &nbsp;&middot;&nbsp; {time_display}
            </div>
            <div style="margin-top:16px;">
              <span style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:20px;padding:5px 14px;font-size:12px;color:#e0e7ff;margin:0 4px;">
                {source_count} sources
              </span>
              <span style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:20px;padding:5px 14px;font-size:12px;color:#e0e7ff;margin:0 4px;">
                {len(clusters)} stories
              </span>
              <span style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:20px;padding:5px 14px;font-size:12px;color:#e0e7ff;margin:0 4px;">
                {active_sections} sections
              </span>
            </div>
          </td></tr></table>
        </td></tr>

        <!-- LEGEND -->
        <tr><td style="background:#eef2ff;padding:14px 32px;border-bottom:1px solid #e5e7eb;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:12px;color:#6b7280;line-height:1.6;" align="center">
              {_label_badge("🟢 VERIFIED")}&nbsp;&nbsp;2+ credible sources agree
              &nbsp;&nbsp;&nbsp;
              {_label_badge("🟡 DEVELOPING")}&nbsp;&nbsp;Limited confirmation
              &nbsp;&nbsp;&nbsp;
              {_label_badge("🔴 UNVERIFIED")}&nbsp;&nbsp;Single / alt source
            </td>
          </tr></table>
        </td></tr>

        {intelligence_html}

        <!-- BODY -->
        <tr><td style="background:#f9fafb;padding:0 32px 32px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            {section_blocks}
          </table>
        </td></tr>

        <!-- MARKET MOOD + BIG THIS WEEK + ON THE RADAR -->
        <tr><td style="background:#f9fafb;padding:0 32px 24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            {_get_sentiment_section_html()}
            <tr><td style="height:16px;"></td></tr>
            {_insight_box_html("📌", "Big This Week", _get_summarizer_field("big_this_week"),
                               "#1e40af", "#eff6ff", "#dbeafe")}
            <tr><td style="height:16px;"></td></tr>
            {_insight_box_html("🔭", "On the Radar", _get_summarizer_field("on_the_radar"),
                               "#7c3aed", "#f5f3ff", "#ede9fe")}
          </table>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="
          background:#1e1b4b;
          border-radius:0 0 16px 16px;
          padding:24px 32px;
          text-align:center;
        ">
          <div style="font-size:12px;color:#a5b4fc;line-height:1.6;">
            Generated automatically &middot; Verification labels reflect source agreement, not absolute truth.
            <br>Always consult primary sources for critical decisions.
          </div>
          <div style="font-size:11px;color:#6366f1;margin-top:10px;">
            News Intelligence System v1.0
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def format_briefing_text(
    clusters: List[StoryCluster],
    source_count: int = 0,
    intelligence_text: str = "",
) -> str:
    """Plain-text fallback for file output / terminals."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sections_map: Dict[str, List[StoryCluster]] = {cat: [] for cat in SECTION_ORDER}
    for c in clusters:
        if c.category in sections_map:
            sections_map[c.category].append(c)

    lines: List[str] = [
        f"DAILY INTELLIGENCE BRIEFING",
        f"Generated: {now}  |  {source_count} sources  |  {len(clusters)} stories",
        "",
    ]

    if intelligence_text:
        lines.append(intelligence_text)

    for section in SECTION_ORDER:
        section_clusters = sections_map.get(section, [])
        if not section_clusters:
            continue
        icon = SECTION_ICONS.get(section, "")
        lines.append(f"\n{'='*60}")
        lines.append(f"  {icon}  {section}")
        lines.append(f"{'='*60}\n")

        for cluster in section_clusters[:MAX_STORIES_PER_SECTION]:
            summary = getattr(cluster, "ai_summary", None)
            if not summary:
                rep = cluster.representative
                summary = rep.summary if rep else cluster.headline
            timestamp = _format_timestamp(cluster.newest)
            source_links = _get_source_links(cluster)
            thread_label = getattr(cluster, "thread_label", "")
            thread_str = f"  [{thread_label}]" if thread_label else ""
            lines.append(f"  {cluster.label}  {cluster.headline}")
            lines.append(f"    [{timestamp}]{thread_str}")
            for line in summary.split("\n"):
                lines.append(f"    {line}")
            lines.append(f"    Read more:")
            for pub, link in source_links:
                lines.append(f"      → {pub}: {link}")
            lines.append("")

    try:
        from news_intel import summarizer
        from news_intel.sentiment import format_sentiment_section
        mood = format_sentiment_section(summarizer.sentiment_scores, summarizer.sentiment_notes)
        if mood:
            lines.append(f"\n{'='*60}")
            lines.append(f"  💹  Market Mood")
            lines.append(f"{'='*60}\n")
            for line in mood.split("\n"):
                lines.append(f"    {line}")
            lines.append("")
    except Exception:
        pass

    big_week = _get_summarizer_field("big_this_week")
    if big_week:
        lines.append(f"\n{'='*60}")
        lines.append(f"  📌  Big This Week")
        lines.append(f"{'='*60}\n")
        for line in big_week.split("\n"):
            lines.append(f"    {line}")
        lines.append("")

    radar = _get_summarizer_field("on_the_radar")
    if radar:
        lines.append(f"\n{'='*60}")
        lines.append(f"  🔭  On the Radar")
        lines.append(f"{'='*60}\n")
        for line in radar.split("\n"):
            lines.append(f"    {line}")
        lines.append("")

    lines.append(f"\n--- END OF BRIEFING — {now} ---")
    return "\n".join(lines)


def format_briefing(
    clusters: List[StoryCluster],
    source_count: int = 0,
    intelligence_html: str = "",
    intelligence_text: str = "",
) -> Tuple[str, str]:
    """
    Build both HTML and plain-text versions of the briefing.

    Args:
        intelligence_html: Optional HTML from the intelligence layer, injected
                           between the header and body sections.
        intelligence_text: Optional text from the intelligence layer, prepended
                           before the section output.

    Returns:
        (html_content, plaintext_content)
    """
    html_out = format_briefing_html(clusters, source_count, intelligence_html=intelligence_html)
    text_out = format_briefing_text(clusters, source_count, intelligence_text=intelligence_text)
    logger.info("Formatted briefing: HTML=%d chars, text=%d chars", len(html_out), len(text_out))
    return html_out, text_out

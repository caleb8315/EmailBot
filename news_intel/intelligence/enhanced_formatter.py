"""
Enhanced Output Formatter (Layer 6).

Produces the intelligence layer's HTML and plain-text sections
that get prepended BEFORE the original briefing output.

Design principles:
- Visual consistency with existing email design
- Standalone sections that don't modify original output
- Graceful degradation if any section data is missing
"""

from __future__ import annotations

import html
import logging
from typing import List, Optional

from news_intel.intelligence.signal_extractor import Signal
from news_intel.intelligence.insight_engine import Insight
from news_intel.intelligence.power_nodes import PowerNode
from news_intel.intelligence.contrarian import ContrarianAlert

logger = logging.getLogger(__name__)


def _esc(text: str) -> str:
    return html.escape(text)


# ---------------------------------------------------------------------------
# HTML Sections
# ---------------------------------------------------------------------------

def _one_sentence_html(sentence: str) -> str:
    if not sentence:
        return ""
    return f"""
        <tr><td style="padding:24px 32px 0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="
            background:linear-gradient(135deg,#1c1a00 0%,#2d2800 100%);
            border:1px solid #3d3200;
            border-radius:12px;
          "><tr><td style="padding:20px 24px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#d29922;margin-bottom:8px;">
              ⚡ TODAY IN ONE SENTENCE
            </div>
            <div style="font-size:16px;font-weight:600;color:#e3b341;line-height:1.5;">
              {_esc(sentence)}
            </div>
          </td></tr></table>
        </td></tr>"""


def _signals_html(signals: List[Signal]) -> str:
    if not signals:
        return ""

    direction_icons = {
        "up": "📈", "down": "📉", "neutral": "➡️",
        "escalation": "🔺", "de-escalation": "🔻",
    }
    confidence_colors = {
        "high": "#3fb950", "medium": "#d29922", "low": "#8b949e",
    }

    rows = ""
    for sig in signals[:8]:
        icon = direction_icons.get(sig.direction, "•")
        conf_color = confidence_colors.get(sig.confidence, "#8b949e")
        drivers_str = ", ".join(sig.drivers[:2]) if sig.drivers else ""
        rows += f"""
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #30363d;font-size:13px;color:#c9d1d9;">
                <span style="font-size:16px;">{icon}</span>&nbsp;
                <strong>{_esc(sig.title)}</strong>
                <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;
                  font-size:10px;font-weight:700;color:{conf_color};background:#161b22;border:1px solid {conf_color};">
                  {sig.confidence.upper()}
                </span>
                <br>
                <span style="font-size:11px;color:#8b949e;margin-left:28px;">
                  {sig.type.capitalize()} · {sig.sources_count} sources{(' · ' + _esc(drivers_str)) if drivers_str else ''}
                </span>
              </td>
            </tr>"""

    return f"""
        <tr><td style="padding:20px 32px 0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="
            background:#161b22;
            border:1px solid #30363d;
            border-radius:12px;
          "><tr><td style="padding:16px 20px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#818cf8;margin-bottom:12px;">
              🧠 KEY SIGNALS
            </div>
            <table width="100%" cellpadding="0" cellspacing="0">
              {rows}
            </table>
          </td></tr></table>
        </td></tr>"""


def _insight_html(insight: Insight) -> str:
    if not insight.summary or insight.summary == "Analysis unavailable":
        return ""

    impl_items = ""
    for imp in insight.implications[:5]:
        impl_items += f'<li style="margin-bottom:4px;color:#c9d1d9;">{_esc(imp)}</li>'

    risk_items = ""
    for risk in insight.risk_scenarios[:4]:
        risk_items += f'<li style="margin-bottom:4px;color:#f85149;">{_esc(risk)}</li>'

    return f"""
        <tr><td style="padding:20px 32px 0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="
            background:#0c2d6b;
            border:1px solid #1f3d6f;
            border-left:4px solid #58a6ff;
            border-radius:12px;
          "><tr><td style="padding:16px 20px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#58a6ff;margin-bottom:10px;">
              📊 MARKET INTELLIGENCE
            </div>
            <div style="font-size:14px;color:#c9d1d9;line-height:1.65;margin-bottom:12px;">
              {_esc(insight.summary)}
            </div>
            <div style="font-size:12px;font-weight:700;color:#58a6ff;margin-bottom:6px;">Implications:</div>
            <ul style="margin:0 0 12px 16px;padding:0;font-size:13px;line-height:1.6;">
              {impl_items}
            </ul>
            <div style="font-size:12px;font-weight:700;color:#f85149;margin-bottom:6px;">⚠️ Risk Scenarios:</div>
            <ul style="margin:0 0 0 16px;padding:0;font-size:13px;line-height:1.6;">
              {risk_items}
            </ul>
          </td></tr></table>
        </td></tr>"""


def _contrarian_html(alerts: List[ContrarianAlert]) -> str:
    if not alerts:
        return ""

    items = ""
    for alert in alerts[:4]:
        items += f"""
            <tr><td style="padding:8px 0;border-bottom:1px solid #3d2800;">
              <div style="font-size:13px;font-weight:600;color:#e6edf3;">
                🔄 {_esc(alert.consensus)}
              </div>
              <div style="font-size:12px;color:#d29922;margin-top:4px;">
                Risk: {_esc(alert.risk)}
              </div>
            </td></tr>"""

    return f"""
        <tr><td style="padding:20px 32px 0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="
            background:#1c1a00;
            border:1px solid #3d3200;
            border-left:4px solid #d29922;
            border-radius:12px;
          "><tr><td style="padding:16px 20px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#d29922;margin-bottom:10px;">
              ⚠️ CONTRARIAN WATCH
            </div>
            <table width="100%" cellpadding="0" cellspacing="0">
              {items}
            </table>
          </td></tr></table>
        </td></tr>"""


def _blindspots_html(blindspots: List[str]) -> str:
    if not blindspots:
        return ""

    items = "".join(
        f'<li style="margin-bottom:4px;color:#f85149;font-size:13px;">{_esc(b)}</li>'
        for b in blindspots[:8]
    )

    return f"""
        <tr><td style="padding:20px 32px 0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="
            background:#1c0f0f;
            border:1px solid #3d1515;
            border-left:4px solid #f85149;
            border-radius:12px;
          "><tr><td style="padding:16px 20px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#f85149;margin-bottom:10px;">
              🚨 BLINDSPOTS — Missing Coverage
            </div>
            <ul style="margin:0 0 0 16px;padding:0;line-height:1.7;">
              {items}
            </ul>
          </td></tr></table>
        </td></tr>"""


def _power_nodes_html(nodes: List[PowerNode]) -> str:
    if not nodes:
        return ""

    activity_colors = {
        "high": ("#f85149", "#1c0f0f"),
        "medium": ("#d29922", "#1c1a00"),
        "low": ("#8b949e", "#161b22"),
    }

    rows = ""
    for node in nodes[:10]:
        color, bg = activity_colors.get(node.activity, ("#8b949e", "#161b22"))
        rows += f"""
            <tr>
              <td style="padding:6px 0;border-bottom:1px solid #30363d;">
                <strong style="font-size:13px;color:#e6edf3;">{_esc(node.entity)}</strong>
                <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;
                  font-size:10px;font-weight:700;color:{color};background:{bg};border:1px solid {color};">
                  {node.activity.upper()}
                </span>
                <span style="display:inline-block;margin-left:6px;font-size:11px;color:#8b949e;">
                  ({node.mention_count} mentions)
                </span>
                <br>
                <span style="font-size:12px;color:#8b949e;margin-left:0;">{_esc(node.context[:100])}</span>
              </td>
            </tr>"""

    return f"""
        <tr><td style="padding:20px 32px 0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="
            background:#161b22;
            border:1px solid #30363d;
            border-radius:12px;
          "><tr><td style="padding:16px 20px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#bc8cff;margin-bottom:12px;">
              🔄 POWER NODE TRACKER
            </div>
            <table width="100%" cellpadding="0" cellspacing="0">
              {rows}
            </table>
          </td></tr></table>
        </td></tr>"""


def _opportunities_html(opportunities: List[str]) -> str:
    if not opportunities:
        return ""

    items = "".join(
        f'<li style="margin-bottom:6px;color:#3fb950;font-size:13px;line-height:1.5;">{_esc(opp)}</li>'
        for opp in opportunities[:6]
    )

    return f"""
        <tr><td style="padding:20px 32px 0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="
            background:#0d1f14;
            border:1px solid #1b4332;
            border-left:4px solid #3fb950;
            border-radius:12px;
          "><tr><td style="padding:16px 20px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#3fb950;margin-bottom:10px;">
              💡 OPPORTUNITIES
            </div>
            <ul style="margin:0 0 0 16px;padding:0;line-height:1.7;">
              {items}
            </ul>
          </td></tr></table>
        </td></tr>"""


def _section_divider_html() -> str:
    return """
        <tr><td style="padding:24px 32px 8px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="border-bottom:2px solid #30363d;"></td></tr>
            <tr><td style="padding-top:4px;text-align:center;font-size:11px;color:#8b949e;letter-spacing:1px;text-transform:uppercase;">
              Full Briefing Below
            </td></tr>
          </table>
        </td></tr>"""


def format_intelligence_html(
    one_sentence: str,
    signals: List[Signal],
    insight: Insight,
    contrarian: List[ContrarianAlert],
    blindspots: List[str],
    power_nodes: List[PowerNode],
    opportunities: List[str],
) -> str:
    """
    Build the complete intelligence HTML section.

    This gets injected between the header/legend and the main body
    sections of the existing briefing.
    """
    sections = [
        _one_sentence_html(one_sentence),
        _signals_html(signals),
        _insight_html(insight),
        _contrarian_html(contrarian),
        _blindspots_html(blindspots),
        _power_nodes_html(power_nodes),
        _opportunities_html(opportunities),
    ]

    content = "".join(s for s in sections if s)
    if not content:
        return ""

    content += _section_divider_html()

    return f"""
        <!-- INTELLIGENCE LAYER START -->
        <tr><td style="background:#0d1117;padding:0 0 0 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            {content}
          </table>
        </td></tr>
        <!-- INTELLIGENCE LAYER END -->"""


# ---------------------------------------------------------------------------
# Plain-text Sections
# ---------------------------------------------------------------------------

def format_intelligence_text(
    one_sentence: str,
    signals: List[Signal],
    insight: Insight,
    contrarian: List[ContrarianAlert],
    blindspots: List[str],
    power_nodes: List[PowerNode],
    opportunities: List[str],
) -> str:
    """Build the complete intelligence plain-text section."""
    lines: List[str] = []

    direction_arrows = {
        "up": "↑", "down": "↓", "neutral": "→",
        "escalation": "▲", "de-escalation": "▼",
    }

    if one_sentence:
        lines.append(f"\n{'='*60}")
        lines.append(f"  ⚡  TODAY IN ONE SENTENCE")
        lines.append(f"{'='*60}\n")
        lines.append(f"    {one_sentence}")
        lines.append("")

    if signals:
        lines.append(f"\n{'='*60}")
        lines.append(f"  🧠  KEY SIGNALS")
        lines.append(f"{'='*60}\n")
        for sig in signals[:8]:
            arrow = direction_arrows.get(sig.direction, "•")
            lines.append(f"  {arrow} [{sig.confidence.upper()}] {sig.title}")
            lines.append(f"    Type: {sig.type} | Sources: {sig.sources_count}")
            if sig.drivers:
                lines.append(f"    Drivers: {', '.join(sig.drivers[:3])}")
            lines.append("")

    if insight.summary and insight.summary != "Analysis unavailable":
        lines.append(f"\n{'='*60}")
        lines.append(f"  📊  MARKET INTELLIGENCE")
        lines.append(f"{'='*60}\n")
        lines.append(f"    {insight.summary}")
        lines.append("")
        if insight.implications:
            lines.append("    Implications:")
            for imp in insight.implications[:5]:
                lines.append(f"      • {imp}")
            lines.append("")
        if insight.risk_scenarios:
            lines.append("    ⚠️ Risk Scenarios:")
            for risk in insight.risk_scenarios[:4]:
                lines.append(f"      • {risk}")
            lines.append("")

    if contrarian:
        lines.append(f"\n{'='*60}")
        lines.append(f"  ⚠️  CONTRARIAN WATCH")
        lines.append(f"{'='*60}\n")
        for alert in contrarian[:4]:
            lines.append(f"    Consensus: {alert.consensus}")
            lines.append(f"    Risk: {alert.risk}")
            lines.append("")

    if blindspots:
        lines.append(f"\n{'='*60}")
        lines.append(f"  🚨  BLINDSPOTS")
        lines.append(f"{'='*60}\n")
        for b in blindspots[:8]:
            lines.append(f"    • {b}")
        lines.append("")

    if power_nodes:
        lines.append(f"\n{'='*60}")
        lines.append(f"  🔄  POWER NODES")
        lines.append(f"{'='*60}\n")
        for node in power_nodes[:10]:
            lines.append(f"    {node.entity} [{node.activity.upper()}] ({node.mention_count} mentions)")
            lines.append(f"      {node.context[:100]}")
            lines.append("")

    if opportunities:
        lines.append(f"\n{'='*60}")
        lines.append(f"  💡  OPPORTUNITIES")
        lines.append(f"{'='*60}\n")
        for opp in opportunities[:6]:
            lines.append(f"    • {opp}")
        lines.append("")

    if lines:
        lines.append(f"\n{'─'*60}")
        lines.append(f"  ▼  FULL BRIEFING BELOW  ▼")
        lines.append(f"{'─'*60}\n")

    return "\n".join(lines)

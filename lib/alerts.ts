import type { PatternMatch, AlertTier, Anomaly } from './types';

const ALERT_CONFIG: Record<AlertTier, {
  description: string;
  channels: string[];
}> = {
  FLASH: {
    description: 'Cross-domain anomaly, doomsday plane, or high-severity pattern',
    channels: ['telegram_push'],
  },
  PRIORITY: {
    description: 'Single-source high-confidence or pattern match',
    channels: ['telegram'],
  },
  DAILY: {
    description: 'Instability score changes, trend shifts',
    channels: ['email', 'dashboard'],
  },
  WEEKLY: {
    description: 'Strategic assessment, pattern evolution, calibration report',
    channels: ['email'],
  },
};

// ── Structured prompt builder ───────────────────────────────────────────
// Rules did the analysis. LLM just explains it.

export function buildStructuredPrompt(match: PatternMatch): string {
  const signalDescriptions = match.events
    .slice(0, 10)
    .map(e =>
      `- ${e.type} (${e.source}): ${e.title} [severity: ${e.severity}, confidence: ${e.confidence}]`,
    )
    .join('\n');

  const userBeliefContext = match.relevantUserBeliefs
    ?.map(b => `- User believes (${Math.round(b.confidence * 100)}%): "${b.statement}"`)
    .join('\n') || 'None';

  return `
PATTERN DETECTED: "${match.pattern.name}"
Historical accuracy: ${Math.round(match.pattern.historicalHitRate * 100)}%
(fired ${match.pattern.historicalSampleSize} times historically)
Median time to next event: ${match.pattern.nextEventMedianHours} hours

SIGNALS THAT TRIGGERED THIS PATTERN:
${signalDescriptions}

REGION: ${match.region.name || 'Global'}

USER'S RELEVANT STATED BELIEFS:
${userBeliefContext}

YOUR TASK: Write exactly 3 paragraphs.
Para 1: What the signals show and why this pattern is significant RIGHT NOW
Para 2: The strongest argument this is NOT what it looks like (red team view)
Para 3: The 3 most important things to watch in the next 48 hours and why

Tone: Direct. Analyst to analyst. No hedging. No caveats. State your view.
Max 300 words total.
  `.trim();
}

// ── Alert dispatch ──────────────────────────────────────────────────────

export async function dispatchPatternAlert(
  match: PatternMatch,
  narrative?: string,
): Promise<void> {
  const tier = match.pattern.alertTier;
  const config = ALERT_CONFIG[tier];

  if (config.channels.includes('telegram_push') || config.channels.includes('telegram')) {
    await sendTelegramAlert(match, narrative);
  }

  console.log(`[alerts] ${tier} alert dispatched for ${match.pattern.name} in ${match.region.name}`);
}

export async function dispatchAnomalyAlert(anomaly: Anomaly): Promise<void> {
  if (anomaly.significance < 60) return;

  const tier: AlertTier = anomaly.significance >= 80 ? 'FLASH' : 'PRIORITY';
  const msg = formatAnomalyMessage(anomaly);

  if (tier === 'FLASH' || tier === 'PRIORITY') {
    await sendTelegramMessage(msg);
  }
}

function formatAnomalyMessage(anomaly: Anomaly): string {
  const dir = anomaly.direction === 'surge' ? '📈 SURGE' : '📉 SILENCE';
  return [
    `⚠️ ANOMALY: ${dir}`,
    `${anomaly.source.toUpperCase()} in ${anomaly.country_code}`,
    `Z-score: ${anomaly.z_score.toFixed(1)} (${anomaly.recent_count} vs ${anomaly.baseline_mean.toFixed(1)} baseline)`,
    `Significance: ${anomaly.significance.toFixed(0)}/100`,
  ].join('\n');
}

async function sendTelegramAlert(match: PatternMatch, narrative?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const header = match.pattern.alertTier === 'FLASH' ? '🔴 FLASH' : '🟡 PRIORITY';
  const hitRate = Math.round(match.pattern.historicalHitRate * 100);
  const signalList = match.events
    .slice(0, 5)
    .map(e => `• ${e.type}: ${e.title.slice(0, 80)}`)
    .join('\n');

  let text = [
    `${header}: ${match.pattern.name.replace(/_/g, ' ').toUpperCase()}`,
    `Region: ${match.region.name} | Severity: ${match.composite_severity.toFixed(0)}/100`,
    `Historical accuracy: ${hitRate}% (n=${match.pattern.historicalSampleSize})`,
    `Next event in ~${match.pattern.nextEventMedianHours}hrs historically`,
    '',
    'SIGNALS:',
    signalList,
  ].join('\n');

  if (narrative) {
    text += '\n\nANALYSIS:\n' + narrative.slice(0, 1500);
  }

  // Truncate to Telegram limit
  if (text.length > 4090) text = text.slice(0, 4087) + '...';

  await sendTelegramMessage(text);
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('[alerts] Telegram send failed:', err);
  }
}

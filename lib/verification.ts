/**
 * Shared verification engine — gates events/articles from reaching
 * high-priority alerts unless corroborated by trusted independent sources.
 *
 * Unverified items are quarantined and periodically re-evaluated;
 * they auto-promote when corroboration criteria are met, or expire.
 */
import type {
  IntelEvent,
  VerificationStatus,
  VerificationMeta,
  CorroborationEvidence,
} from './types';

// ── Thresholds ──────────────────────────────────────────────────────────────

const VERIFIED_MIN_SOURCES = 2;
const VERIFIED_MIN_CREDIBLE = 2;
const DEVELOPING_MIN_SOURCES = 2;
const QUARANTINE_EXPIRY_HOURS = 48;
const MAX_RECHECK_COUNT = 8;

// Domains whose reporting alone is sufficient for "credible" status.
// Must match canonical hostname (no substring tricks).
const CREDIBLE_DOMAINS = new Set([
  'reuters.com',
  'apnews.com',
  'bbc.co.uk',
  'bbc.com',
  'bloomberg.com',
  'nytimes.com',
  'washingtonpost.com',
  'theguardian.com',
  'ft.com',
  'aljazeera.com',
  'france24.com',
  'dw.com',
  'npr.org',
]);

// ── Non-kinetic context patterns ────────────────────────────────────────────
// If title/summary matches these AND there is no actual kinetic evidence,
// suppress conflict/military escalation.
const NON_KINETIC_PATTERNS = [
  /\blgbt/i, /\brights\b/i, /\bcivil\s*rights/i, /\babortion/i,
  /\bgender/i, /\bsame[- ]sex/i, /\bdiscrimination\b/i, /\bequality\b/i,
  /\btransgender/i, /\bprotest.*law\b/i, /\blegislat/i, /\bpolicy\b/i,
  /\bcourt\s*rul/i, /\bsupreme\s*court/i, /\blawsuit/i, /\bverdict/i,
  /\bconversion\s*therapy/i, /\bhate\s*crime\s*law/i, /\bvoting\s*rights/i,
  /\bfreedom\s*of\s*speech/i, /\bpress\s*freedom/i, /\bcensorship\b/i,
  /\bimmigration\s*policy/i, /\bsanctuary\s*city/i, /\bexecutive\s*order/i,
  /\bgun\s*control/i, /\bgun\s*law/i, /\bregulat(ion|ory)/i,
];

const KINETIC_EVIDENCE = [
  /\bkill(ed|ing|s)\s*\d/i, /\bexplo(sion|ded)/i, /\bbomb(ing|ed)/i,
  /\bshell(ing|ed)/i, /\bmissile/i, /\bairstrike/i, /\bdrone\s*strike/i,
  /\bgunfire/i, /\bartiller/i, /\bcasualt/i, /\bfatalit/i,
  /\bwound(ed|s)/i, /\binvasion/i, /\bseiz(ed|ure)/i,
];

// ── Helpers ─────────────────────────────────────────────────────────────────

export function extractCanonicalDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isDomainMatch(candidate: string, trusted: string): boolean {
  const c = candidate.toLowerCase().replace(/^www\./, '');
  const t = trusted.toLowerCase().replace(/^www\./, '');
  return c === t || c.endsWith('.' + t);
}

export function isDomainBlocked(domain: string, blocklist: string[]): boolean {
  return blocklist.some(blocked => isDomainMatch(domain, blocked));
}

export function isDomainCredible(domain: string): boolean {
  for (const credible of CREDIBLE_DOMAINS) {
    if (isDomainMatch(domain, credible)) return true;
  }
  return false;
}

export function isNonKineticContext(text: string): boolean {
  const hasNonKinetic = NON_KINETIC_PATTERNS.some(p => p.test(text));
  if (!hasNonKinetic) return false;
  const hasKinetic = KINETIC_EVIDENCE.some(p => p.test(text));
  return !hasKinetic;
}

// ── Verification logic ──────────────────────────────────────────────────────

export function createInitialVerification(
  sourceCount: number,
  credibleCount: number,
  domains: string[],
): VerificationMeta {
  const now = new Date().toISOString();
  const corroboration: CorroborationEvidence = {
    source_count: sourceCount,
    credible_source_count: credibleCount,
    distinct_domains: domains,
    first_seen: now,
    last_corroborated: now,
    recheck_count: 0,
  };

  const status = computeVerificationStatus(corroboration);
  const log: string[] = [`Initial status: ${status} (sources=${sourceCount}, credible=${credibleCount})`];

  return {
    status,
    corroboration,
    quarantined_at: status === 'quarantined' ? now : undefined,
    decision_log: log,
  };
}

export function computeVerificationStatus(
  corroboration: CorroborationEvidence,
): VerificationStatus {
  if (corroboration.credible_source_count >= VERIFIED_MIN_CREDIBLE
      && corroboration.source_count >= VERIFIED_MIN_SOURCES) {
    return 'verified';
  }
  if (corroboration.source_count >= DEVELOPING_MIN_SOURCES) {
    return 'developing';
  }
  // Single article from a credible/trusted source is "developing" not quarantined
  if (corroboration.credible_source_count >= 1) {
    return 'developing';
  }
  return 'quarantined';
}

export function recheckVerification(
  meta: VerificationMeta,
  newSourceCount: number,
  newCredibleCount: number,
  newDomains: string[],
): VerificationMeta {
  const now = new Date().toISOString();
  const updated = { ...meta };
  const corr = { ...updated.corroboration };

  corr.source_count = Math.max(corr.source_count, newSourceCount);
  corr.credible_source_count = Math.max(corr.credible_source_count, newCredibleCount);
  const domainSet = new Set([...corr.distinct_domains, ...newDomains]);
  corr.distinct_domains = [...domainSet];
  corr.last_corroborated = now;
  corr.recheck_count += 1;

  const newStatus = computeVerificationStatus(corr);
  updated.corroboration = corr;

  if (newStatus !== updated.status) {
    updated.decision_log = [
      ...updated.decision_log,
      `Recheck #${corr.recheck_count}: ${updated.status} -> ${newStatus} (sources=${corr.source_count}, credible=${corr.credible_source_count})`,
    ];
    if (newStatus === 'verified' || newStatus === 'developing') {
      updated.promoted_at = now;
    }
    updated.status = newStatus;
  }

  return updated;
}

export function isQuarantineExpired(meta: VerificationMeta): boolean {
  if (meta.status !== 'quarantined' || !meta.quarantined_at) return false;
  const elapsed = (Date.now() - new Date(meta.quarantined_at).getTime()) / (1000 * 60 * 60);
  return elapsed > QUARANTINE_EXPIRY_HOURS || meta.corroboration.recheck_count >= MAX_RECHECK_COUNT;
}

export function canAlert(meta: VerificationMeta, tier: string): boolean {
  if (meta.status === 'blocked') return false;
  if (meta.status === 'quarantined') return false;
  if (tier === 'FLASH' || tier === 'PRIORITY') {
    return meta.status === 'verified' || meta.status === 'developing';
  }
  return meta.status === 'verified' || meta.status === 'developing' || meta.status === 'unverified';
}

// ── Event-level verification assignment ─────────────────────────────────────

export function assignVerificationToEvent(event: IntelEvent): IntelEvent {
  const text = `${event.title} ${event.summary}`;

  const sourceUrl = (event.raw_data?.source_url ?? event.raw_data?.url ?? '') as string;
  const domain = extractCanonicalDomain(sourceUrl);
  const numArticles = (event.raw_data?.num_articles as number) ?? 1;
  const numSources = (event.raw_data?.num_sources as number) ?? 1;
  const credibleCount = isDomainCredible(domain) ? 1 : 0;

  const verification = createInitialVerification(
    numSources,
    credibleCount,
    domain ? [domain] : [],
  );

  if (isNonKineticContext(text)) {
    verification.status = 'quarantined';
    verification.quarantined_at = new Date().toISOString();
    verification.decision_log.push(
      `Quarantined: non-kinetic context detected (civil-rights/policy/legal language without kinetic evidence)`,
    );
    event.severity = Math.min(event.severity, 30);
    if (event.type === 'conflict' || event.type === 'airstrike') {
      event.type = 'news_signal';
    }
  }

  return { ...event, verification };
}

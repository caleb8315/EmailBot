/**
 * Regression tests for the verification module.
 *
 * Run: npx ts-node lib/__tests__/verification.test.ts
 */
import {
  extractCanonicalDomain,
  isDomainMatch,
  isDomainBlocked,
  isDomainCredible,
  isNonKineticContext,
  createInitialVerification,
  recheckVerification,
  computeVerificationStatus,
  isQuarantineExpired,
  canAlert,
  assignVerificationToEvent,
} from '../verification';
import type { IntelEvent } from '../types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// ── Domain extraction ───────────────────────────────────────────────────

section('extractCanonicalDomain');
assert(extractCanonicalDomain('https://www.reuters.com/world/foo') === 'reuters.com', 'strips www');
assert(extractCanonicalDomain('https://reuters.com/path') === 'reuters.com', 'no www');
assert(extractCanonicalDomain('https://sub.reuters.com/bar') === 'sub.reuters.com', 'keeps subdomain');
assert(extractCanonicalDomain('not-a-url') === '', 'invalid url returns empty');

// ── Domain matching (spoof-resistant) ───────────────────────────────────

section('isDomainMatch');
assert(isDomainMatch('reuters.com', 'reuters.com'), 'exact match');
assert(isDomainMatch('www.reuters.com', 'reuters.com'), 'www prefix');
assert(isDomainMatch('sub.reuters.com', 'reuters.com'), 'subdomain matches parent');
assert(!isDomainMatch('reuters.com.evil.com', 'reuters.com'), 'rejects spoof suffix');
assert(!isDomainMatch('notreuters.com', 'reuters.com'), 'rejects partial prefix');
assert(!isDomainMatch('fakereuters.com', 'reuters.com'), 'rejects concatenation');

// ── Domain blocklist ────────────────────────────────────────────────────

section('isDomainBlocked');
const blocklist = ['infowars.com', 'naturalnews.com'];
assert(isDomainBlocked('infowars.com', blocklist), 'blocked domain');
assert(isDomainBlocked('www.infowars.com', blocklist), 'blocked www prefix');
assert(!isDomainBlocked('reuters.com', blocklist), 'clean domain not blocked');
assert(!isDomainBlocked('infowars.com.safe.org', blocklist), 'spoof not blocked');

// ── Credible domains ────────────────────────────────────────────────────

section('isDomainCredible');
assert(isDomainCredible('reuters.com'), 'reuters is credible');
assert(isDomainCredible('www.bbc.co.uk'), 'bbc is credible');
assert(!isDomainCredible('randomnews.xyz'), 'unknown is not credible');
assert(!isDomainCredible('reuters.com.evil.com'), 'spoof not credible');

// ── Non-kinetic context detection ───────────────────────────────────────

section('isNonKineticContext');
assert(isNonKineticContext('LGBT rights under attack in Denver, Colorado'), 'LGBT rights = non-kinetic');
assert(isNonKineticContext('Supreme Court ruling on civil rights law'), 'court ruling = non-kinetic');
assert(isNonKineticContext('New legislation on gender equality policy'), 'policy = non-kinetic');
assert(isNonKineticContext('Abortion rights protest at state capitol'), 'abortion rights = non-kinetic');
assert(isNonKineticContext('Voting rights bill faces opposition in senate'), 'voting rights = non-kinetic');
assert(!isNonKineticContext('Airstrike kills 15 in northern Syria'), 'actual airstrike = kinetic');
assert(!isNonKineticContext('Explosion rocks downtown, casualties reported'), 'explosion = kinetic');
assert(!isNonKineticContext('Missile strike on military base confirmed'), 'missile = kinetic');
assert(!isNonKineticContext('Russia deploys new tanks to border'), 'military = kinetic');
assert(!isNonKineticContext('Apple announces new iPhone features'), 'neutral tech = not non-kinetic');

// ── Verification status computation ─────────────────────────────────────

section('computeVerificationStatus');
assert(computeVerificationStatus({
  source_count: 3, credible_source_count: 2, distinct_domains: ['a.com', 'b.com', 'c.com'],
  first_seen: '', last_corroborated: '', recheck_count: 0,
}) === 'verified', '3 sources 2 credible = verified');

assert(computeVerificationStatus({
  source_count: 2, credible_source_count: 0, distinct_domains: ['a.com', 'b.com'],
  first_seen: '', last_corroborated: '', recheck_count: 0,
}) === 'developing', '2 sources 0 credible = developing');

assert(computeVerificationStatus({
  source_count: 1, credible_source_count: 0, distinct_domains: ['a.com'],
  first_seen: '', last_corroborated: '', recheck_count: 0,
}) === 'quarantined', 'single unknown source = quarantined');

assert(computeVerificationStatus({
  source_count: 1, credible_source_count: 1, distinct_domains: ['reuters.com'],
  first_seen: '', last_corroborated: '', recheck_count: 0,
}) === 'developing', 'single credible source = developing (not quarantined)');

// ── canAlert ────────────────────────────────────────────────────────────

section('canAlert');
const verifiedMeta = createInitialVerification(3, 2, ['a.com', 'b.com', 'c.com']);
const quarantinedMeta = createInitialVerification(1, 0, ['unknown.com']);
const blockedMeta = createInitialVerification(0, 0, []);
blockedMeta.status = 'blocked';

assert(canAlert(verifiedMeta, 'FLASH'), 'verified can alert FLASH');
assert(canAlert(verifiedMeta, 'PRIORITY'), 'verified can alert PRIORITY');
assert(!canAlert(quarantinedMeta, 'FLASH'), 'quarantined cannot alert FLASH');
assert(!canAlert(quarantinedMeta, 'PRIORITY'), 'quarantined cannot alert PRIORITY');
assert(!canAlert(blockedMeta, 'FLASH'), 'blocked cannot alert');
assert(!canAlert(blockedMeta, 'DAILY'), 'blocked cannot alert DAILY');

// ── Recheck promotion ───────────────────────────────────────────────────

section('recheckVerification');
const initial = createInitialVerification(1, 0, ['news.com']);
assert(initial.status === 'quarantined', 'starts quarantined');
const afterRecheck = recheckVerification(initial, 3, 2, ['reuters.com', 'bbc.com', 'news.com']);
assert(afterRecheck.status === 'verified', 'promoted to verified after recheck');
assert(afterRecheck.promoted_at !== undefined, 'promoted_at is set');
assert(afterRecheck.decision_log.length > 1, 'decision log records promotion');

// ── assignVerificationToEvent (non-kinetic suppression) ─────────────────

section('assignVerificationToEvent');
const fakeConflictEvent: IntelEvent = {
  source: 'rss',
  type: 'conflict',
  severity: 70,
  confidence: 0.7,
  lat: 39.7392,
  lng: -104.9903,
  country_code: 'US',
  timestamp: new Date().toISOString(),
  title: 'Hostile environment for LGBT rights in Denver, Colorado',
  summary: 'Civil rights groups say new legislation discriminates against LGBT community',
  raw_data: { url: 'https://example.com/lgbtq-rights-denver' },
  tags: ['conflict_rss'],
};
const checked = assignVerificationToEvent(fakeConflictEvent);
assert(checked.verification?.status === 'quarantined', 'LGBT rights article gets quarantined');
assert(checked.type === 'news_signal', 'conflict type downgraded to news_signal');
assert(checked.severity <= 30, 'severity capped at 30');

const realConflictEvent: IntelEvent = {
  source: 'gdelt',
  type: 'airstrike',
  severity: 85,
  confidence: 0.8,
  lat: 36.2,
  lng: 37.1,
  country_code: 'SY',
  timestamp: new Date().toISOString(),
  title: 'Air strike in northern Syria kills 12',
  summary: 'Coalition airstrike killed 12 militants in Idlib province',
  raw_data: { url: 'https://reuters.com/syria-airstrike', num_sources: 5 },
  tags: ['gdelt', 'conflict'],
};
const checkedReal = assignVerificationToEvent(realConflictEvent);
assert(checkedReal.type === 'airstrike', 'real airstrike type preserved');
assert(checkedReal.severity === 85, 'real airstrike severity preserved');

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log('All tests passed.');

/**
 * Run: npx ts-node lib/__tests__/pattern-intel.test.ts
 */
import { parsePatternIntelResponse, patternDedupeTag } from '../pattern-intel';
import type { PatternMatch, IntelEvent } from '../types';
import { PATTERNS } from '../rules-engine';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function fakeMatch(): PatternMatch {
  const pattern = PATTERNS[0];
  const events: IntelEvent[] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      source: 'adsb',
      type: 'military_flight_isr',
      severity: 70,
      confidence: 0.9,
      lat: 1,
      lng: 2,
      country_code: 'UA',
      timestamp: new Date().toISOString(),
      title: 'ISR flight activity',
      summary: 'test',
      raw_data: {},
      tags: ['military'],
      verification: { status: 'verified', corroboration: { source_count: 2, credible_source_count: 2, distinct_domains: ['a.com'], first_seen: '', last_corroborated: '', recheck_count: 0 }, decision_log: [] },
    },
  ];
  return {
    pattern,
    events,
    region: { lat: 0, lng: 0, name: 'UA' },
    matched_at: new Date().toISOString(),
    composite_severity: 80,
  };
}

const match = fakeMatch();

assert(patternDedupeTag(match).includes('pre_operational_posture'), 'dedupe tag includes pattern name');
assert(patternDedupeTag(match).includes('UA'), 'dedupe tag includes region');

const json = JSON.stringify({
  narrative_paragraphs: 'A\n\nB\n\nC',
  hypothesis_primary_title: 'Primary theory about UA',
  hypothesis_competing_title: 'Routine training explains signals',
  prediction_statement: 'Within 48h corroborating kinetic or political move will appear in UA',
  prediction_confidence: 0.41,
});

const parsed = parsePatternIntelResponse(json, match);
assert(parsed.narrative_paragraphs.includes('A'), 'narrative preserved');
assert(parsed.hypothesis_primary_title.includes('Primary'), 'primary title');
assert(parsed.prediction_confidence === 0.41, 'confidence parsed');

const bad = parsePatternIntelResponse('not json {', match);
assert(bad.hypothesis_primary_title.length > 5, 'fallback primary on bad JSON');

console.log(`\npattern-intel tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

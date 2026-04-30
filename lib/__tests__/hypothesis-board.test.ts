/**
 * Pure-logic tests for hypothesis-board source-diversity scoring.
 *
 * Run: npx ts-node lib/__tests__/hypothesis-board.test.ts
 */
import { computeSourceDiversity } from '../hypothesis-board';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

section('computeSourceDiversity');

assert(computeSourceDiversity([]) === 0, 'empty list → 0');
assert(computeSourceDiversity(['rss']) === 0, 'single source → 0');
assert(computeSourceDiversity(['rss', 'rss', 'rss']) === 0, 'all same source → 0');

const balanced = computeSourceDiversity(['rss', 'gdelt', 'acled']);
assert(balanced > 0.95, `3 distinct evenly distributed → ~1 (got ${balanced.toFixed(2)})`);

const skewed = computeSourceDiversity(['rss', 'rss', 'rss', 'rss', 'gdelt']);
assert(
  skewed > 0 && skewed < 0.8,
  `4× rss + 1× gdelt → small but non-zero diversity (got ${skewed.toFixed(2)})`,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

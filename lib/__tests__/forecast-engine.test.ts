/**
 * Math-only tests for the forecast engine prior derivation.
 *
 * Run: npx ts-node lib/__tests__/forecast-engine.test.ts
 */
import { patternPosteriorMean } from '../forecast-engine';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function approx(a: number, b: number, eps = 0.05) {
  return Math.abs(a - b) <= eps;
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

section('patternPosteriorMean');

// Tiny sample size should pull strongly toward 0.5
const small = patternPosteriorMean(0.9, 1);
assert(small < 0.8, `n=1 with claimed 90% is shrunk under 80% (got ${small.toFixed(2)})`);
assert(small > 0.5, `n=1 still moves above the 50% prior (got ${small.toFixed(2)})`);

// Large sample size should mostly trust the historical rate
const large = patternPosteriorMean(0.9, 200);
assert(approx(large, 0.9, 0.05), `n=200 stays close to claimed rate (got ${large.toFixed(2)})`);

// Symmetric: rate 0 with no samples should not collapse to 0
const zero = patternPosteriorMean(0, 0);
assert(zero > 0.1, `zero rate, zero samples doesn't collapse (got ${zero.toFixed(2)})`);

// Edge: claimed 100% with 5 samples should still leave doubt
const hundred5 = patternPosteriorMean(1, 5);
assert(hundred5 < 0.95, `100% w/ n=5 leaves doubt (got ${hundred5.toFixed(2)})`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

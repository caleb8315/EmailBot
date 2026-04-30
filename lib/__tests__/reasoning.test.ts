/**
 * Pure-logic regression tests for the deliberation engine.
 *
 * These intentionally avoid hitting Supabase or any LLM provider — they
 * exercise the math (probability extraction, calibration pull, agreement
 * scoring) so we can run them in CI without secrets.
 *
 * Run: npx ts-node lib/__tests__/reasoning.test.ts
 */
import {
  extractStatedProbability,
  calibrateProbability,
} from '../reasoning';

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

// ── extractStatedProbability ────────────────────────────────────────

section('extractStatedProbability');
assert(extractStatedProbability('Probability: 75%') === 0.75, 'plain "Probability: NN%"');
assert(extractStatedProbability('the chance is approximately 30%') === 0.3, 'phrasing variant');
assert(extractStatedProbability('p = 0.42') === 0.42, 'decimal p =');
assert(extractStatedProbability('There is a 5% chance.') === 0.05, 'small percent in sentence');
assert(extractStatedProbability('No probability given here') === null, 'no probability returns null');
assert(extractStatedProbability('odds are about 90%') === 0.9, '"odds are" phrasing');

// ── calibrateProbability ────────────────────────────────────────────
// If the historical reliability curve says that when we said 70% we
// only observed 50%, then a fresh 70% claim should be pulled down toward
// ~0.5 (the more samples in the bin, the harder it pulls).

section('calibrateProbability');
const curveOverconfident = [
  { bin: 7, predicted: 0.7, observed: 0.5, n: 20 },
];
const adjusted = calibrateProbability(0.7, curveOverconfident, 20);
assert(
  Math.abs(adjusted - 0.5) < 0.01,
  `over-confident bin pulls 0.7 → ~0.5 (got ${adjusted.toFixed(3)})`,
);

// A bin with very few samples should barely move the value
const curveNoisy = [{ bin: 7, predicted: 0.7, observed: 0.5, n: 1 }];
const noisy = calibrateProbability(0.7, curveNoisy, 20);
assert(
  noisy > 0.68 && noisy < 0.71,
  `noisy bin barely moves 0.7 (got ${noisy.toFixed(3)})`,
);

// No curve = identity (clamped)
const passthrough = calibrateProbability(0.42, []);
assert(Math.abs(passthrough - 0.42) < 1e-9, 'empty curve = identity');
assert(calibrateProbability(0.001, []) === 0.02, 'clamps to 0.02 floor');
assert(calibrateProbability(0.999, []) === 0.98, 'clamps to 0.98 ceiling');

// Mismatched bin (no entry for our predicted bucket) returns input
const curveOtherBin = [{ bin: 0, predicted: 0.05, observed: 0.05, n: 100 }];
assert(
  Math.abs(calibrateProbability(0.7, curveOtherBin) - 0.7) < 1e-9,
  'no matching bin = identity',
);

// ── summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

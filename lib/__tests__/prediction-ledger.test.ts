/**
 * Pure-math regression tests for the prediction ledger scoring helpers.
 *
 * Run: npx ts-node lib/__tests__/prediction-ledger.test.ts
 */
import {
  calculateBrierScore,
  calculateLogLoss,
  calibrationBin,
} from '../prediction-ledger';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function approx(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// ── Brier score ─────────────────────────────────────────────────────

section('calculateBrierScore');
assert(calculateBrierScore(1, true) === 0, '100% correct = 0');
assert(calculateBrierScore(0, false) === 0, '0% on a no = 0');
assert(calculateBrierScore(0.5, true) === 0.25, '50% on yes/no = 0.25');
assert(approx(calculateBrierScore(0.8, true), 0.04), '80% correct = 0.04');
assert(approx(calculateBrierScore(0.8, false), 0.64), '80% wrong = 0.64');

// ── Log loss ────────────────────────────────────────────────────────

section('calculateLogLoss');
assert(calculateLogLoss(0.999999, true) < 0.001, 'very confident correct ≈ 0');
assert(calculateLogLoss(0.000001, false) < 0.001, 'very confident on no ≈ 0');
assert(calculateLogLoss(0.5, true) > 0.69 && calculateLogLoss(0.5, true) < 0.7, '50% ≈ ln 2');
// confident but wrong should hurt a lot more under log loss than under brier
const brierWrong = calculateBrierScore(0.99, false);
const logWrong = calculateLogLoss(0.99, false);
assert(logWrong > brierWrong, 'log loss > brier for confident-wrong');

// ── Calibration bin ─────────────────────────────────────────────────

section('calibrationBin');
assert(calibrationBin(0) === 0, '0 → bin 0');
assert(calibrationBin(0.0999) === 0, '0.099 → bin 0');
assert(calibrationBin(0.1) === 1, '0.1 → bin 1');
assert(calibrationBin(0.55) === 5, '0.55 → bin 5');
assert(calibrationBin(0.9) === 9, '0.9 → bin 9');
assert(calibrationBin(0.999) === 9, '0.999 → bin 9 (top bin caps)');
assert(calibrationBin(1) === 9, '1 → bin 9 (clamped)');
assert(calibrationBin(-0.2) === 0, 'negative → bin 0 (clamped)');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

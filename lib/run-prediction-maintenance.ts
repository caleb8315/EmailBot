/**
 * Weekly maintenance: flag overdue predictions for manual resolution.
 * Run: npx ts-node lib/run-prediction-maintenance.ts
 */
import 'dotenv/config';
import { evaluateResolvablePredictions } from './prediction-ledger';

async function main() {
  const r = await evaluateResolvablePredictions();
  console.log('[prediction-maintenance]', r);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

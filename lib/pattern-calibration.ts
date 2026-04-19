import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

const PATTERN_TAG_PREFIX = 'pattern:';

export function extractPatternNameFromTags(tags: string[] | null | undefined): string | null {
  if (!tags?.length) return null;
  for (const t of tags) {
    if (t.startsWith(PATTERN_TAG_PREFIX)) {
      return t.slice(PATTERN_TAG_PREFIX.length).trim() || null;
    }
  }
  return null;
}

function scoreForOutcome(outcome: 'correct' | 'incorrect' | 'partial' | 'unresolvable'): number | null {
  if (outcome === 'unresolvable') return null;
  if (outcome === 'correct') return 1;
  if (outcome === 'partial') return 0.5;
  return 0;
}

/**
 * When a Jeff prediction with a `pattern:` tag resolves, roll stats into pattern_calibration.
 * Safe no-op if table missing or tag absent.
 */
export async function recordPatternOutcomeFromResolution(
  tags: string[] | null | undefined,
  outcome: 'correct' | 'incorrect' | 'partial' | 'unresolvable',
): Promise<void> {
  const patternName = extractPatternNameFromTags(tags);
  if (!patternName) return;

  const delta = scoreForOutcome(outcome);
  if (delta === null) return;

  const sb = getSupabase();
  const now = new Date().toISOString();

  const { data: row } = await sb
    .from('pattern_calibration')
    .select('resolved_total, resolved_correct')
    .eq('pattern_name', patternName)
    .maybeSingle();

  if (row) {
    const total = (row.resolved_total as number) + 1;
    const correct = Number(row.resolved_correct ?? 0) + delta;
    const { error } = await sb
      .from('pattern_calibration')
      .update({
        resolved_total: total,
        resolved_correct: correct,
        last_outcome_at: now,
        updated_at: now,
      })
      .eq('pattern_name', patternName);
    if (error) console.warn('[pattern-calibration] update skipped:', error.message);
    return;
  }

  const { error } = await sb.from('pattern_calibration').insert({
    pattern_name: patternName,
    resolved_total: 1,
    resolved_correct: delta,
    last_outcome_at: now,
    updated_at: now,
  });
  if (error) console.warn('[pattern-calibration] insert skipped:', error.message);
}

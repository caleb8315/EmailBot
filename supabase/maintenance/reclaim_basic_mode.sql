-- Basic-mode reclaim: shrink the Supabase project back under the free tier.
--
-- WHY: the "reasoning brain" (ingestion adapters, belief/hypothesis/forecast
-- engines, dreamtime, deep reasoning traces) writes a very large number of rows.
-- That growth is what pushes a free Supabase project over its limits. The basic
-- news/intel bot (alerts + morning digest + chat) only needs a handful of small
-- tables, so we can safely empty the brain tables to reclaim space.
--
-- SAFETY:
--   * This only TRUNCATES data. It does NOT drop tables, so the brain still works
--     if you re-enable it later — it just starts from an empty history.
--   * Tables kept intact (the basic bot depends on them):
--       usage_tracking, user_preferences, article_history, source_registry,
--       digest_archive, system_events, engine_runs, conversations, user_profile
--   * Run this in the Supabase SQL editor. IF EXISTS guards make it safe to run
--     even if some brain migrations were never applied.
--
-- HOW TO RUN: paste into Supabase → SQL Editor → Run.

DO $$
DECLARE
  t text;
  brain_tables text[] := ARRAY[
    'intel_events',
    'entities',
    'entity_relationships',
    'entity_events',
    'beliefs',
    'user_beliefs',
    'predictions',
    'hypotheses',
    'narrative_arcs',
    'correlations',
    'procurement_signals',
    'satellite_observations',
    'watches',
    'country_risk_scores',
    'prediction_markets',
    'dreamtime_scenarios',
    'after_action_reports',
    'fused_signals',
    'reasoning_traces',
    'prediction_calibration_bins'
  ];
BEGIN
  FOREACH t IN ARRAY brain_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE;', t);
      RAISE NOTICE 'Truncated %', t;
    END IF;
  END LOOP;
END $$;

-- Optional: trim old rows from tables the basic bot keeps, so they do not grow
-- forever. Adjust the intervals to taste (or delete these lines to keep all).
DELETE FROM public.article_history WHERE fetched_at < now() - interval '30 days';
DELETE FROM public.system_events   WHERE created_at  < now() - interval '30 days';
DELETE FROM public.engine_runs     WHERE started_at  < now() - interval '30 days';

-- Reclaim disk from Postgres after the large deletes above.
VACUUM FULL;

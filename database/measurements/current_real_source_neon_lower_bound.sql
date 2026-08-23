\set ON_ERROR_STOP on

-- Reproducible PostgreSQL 18 capacity proof for the real-source profile recorded
-- in docs/AGGREGATE_SOURCE_PROFILE.md on 11 August 2026.
--
-- This intentionally measures only two retained acceptance ledgers and uses the
-- smallest legal representative values. It excludes heap tuple headers, line
-- pointers, indexes, normalized Race facts, race events/entries/source rows,
-- Core/Arena materialization, aggregate tables and future growth. The result is
-- therefore a lower-bound capacity projection, not an estimate of total storage.

WITH source_profile AS (
  SELECT
    2691579::bigint AS race_merge_rows,
    18513::bigint AS core_details_rows,
    1474::bigint AS current_arena_rows,
    (512::bigint * 1024 * 1024) AS preview_branch_limit_bytes
), measured_rows AS (
  SELECT
    pg_column_size(ROW(
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid,
      1::bigint,
      'x'::text,
      repeat('a', 64)::character(64),
      'ready'::text,
      '{}'::text[],
      '2026-08-23T00:00:00Z'::timestamptz
    )::dna.dataset_staged_record)::bigint AS staged_row_bytes,
    pg_column_size(ROW(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'race_merge'::text,
      'x'::text,
      '22222222-2222-4222-8222-222222222222'::uuid,
      repeat('a', 64)::character(64),
      '2026-08-23T00:00:00Z'::timestamptz
    )::dna.dataset_record_contribution)::bigint AS contribution_row_bytes
), projection AS (
  SELECT
    profile.race_merge_rows,
    profile.core_details_rows,
    profile.current_arena_rows,
    profile.race_merge_rows
      + profile.core_details_rows
      + profile.current_arena_rows AS recurring_source_rows,
    measured.staged_row_bytes,
    measured.contribution_row_bytes,
    measured.staged_row_bytes
      + measured.contribution_row_bytes AS retained_bytes_per_source_row_lower_bound,
    (profile.race_merge_rows
      + profile.core_details_rows
      + profile.current_arena_rows)
      * measured.staged_row_bytes AS staged_lower_bound_bytes,
    (profile.race_merge_rows
      + profile.core_details_rows
      + profile.current_arena_rows)
      * measured.contribution_row_bytes AS contribution_lower_bound_bytes,
    (profile.race_merge_rows
      + profile.core_details_rows
      + profile.current_arena_rows)
      * (measured.staged_row_bytes + measured.contribution_row_bytes)
      AS two_ledger_lower_bound_bytes,
    profile.preview_branch_limit_bytes
  FROM source_profile profile
  CROSS JOIN measured_rows measured
), evidence AS (
  SELECT
    projection.*,
    floor(
      projection.preview_branch_limit_bytes::numeric
      / projection.retained_bytes_per_source_row_lower_bound
    )::bigint AS maximum_rows_at_lower_bound,
    projection.recurring_source_rows - floor(
      projection.preview_branch_limit_bytes::numeric
      / projection.retained_bytes_per_source_row_lower_bound
    )::bigint AS rows_over_total_limit_at_lower_bound
  FROM projection
)
SELECT
  race_merge_rows,
  core_details_rows,
  current_arena_rows,
  recurring_source_rows,
  staged_row_bytes,
  contribution_row_bytes,
  retained_bytes_per_source_row_lower_bound,
  staged_lower_bound_bytes,
  contribution_lower_bound_bytes,
  two_ledger_lower_bound_bytes,
  preview_branch_limit_bytes,
  maximum_rows_at_lower_bound,
  rows_over_total_limit_at_lower_bound,
  round(
    100.0 * rows_over_total_limit_at_lower_bound / recurring_source_rows,
    2
  ) AS minimum_rejection_percentage_to_fit_even_this_lower_bound,
  CASE
    WHEN two_ledger_lower_bound_bytes > preview_branch_limit_bytes
      THEN 'UNSAFE_CURRENT_NEON_RETENTION'
    ELSE 'LOWER_BOUND_DOES_NOT_PROVE_UNSAFE'
  END AS capacity_result
FROM evidence;

DO $capacity_assertion$
DECLARE
  v_source_rows bigint := 2691579 + 18513 + 1474;
  v_staged_row_bytes bigint;
  v_contribution_row_bytes bigint;
  v_lower_bound bigint;
  v_limit bigint := 512::bigint * 1024 * 1024;
BEGIN
  SELECT pg_column_size(ROW(
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    1::bigint,
    'x'::text,
    repeat('a', 64)::character(64),
    'ready'::text,
    '{}'::text[],
    '2026-08-23T00:00:00Z'::timestamptz
  )::dna.dataset_staged_record)::bigint
  INTO v_staged_row_bytes;

  SELECT pg_column_size(ROW(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'race_merge'::text,
    'x'::text,
    '22222222-2222-4222-8222-222222222222'::uuid,
    repeat('a', 64)::character(64),
    '2026-08-23T00:00:00Z'::timestamptz
  )::dna.dataset_record_contribution)::bigint
  INTO v_contribution_row_bytes;

  v_lower_bound := v_source_rows * (
    v_staged_row_bytes + v_contribution_row_bytes
  );

  IF v_staged_row_bytes <> 160 OR v_contribution_row_bytes <> 144 THEN
    RAISE EXCEPTION
      'PostgreSQL storage measurement changed: staged %, contribution %',
      v_staged_row_bytes, v_contribution_row_bytes;
  END IF;

  IF v_lower_bound <> 824316064 THEN
    RAISE EXCEPTION 'Real-source lower-bound projection changed: %', v_lower_bound;
  END IF;

  IF v_lower_bound <= v_limit THEN
    RAISE EXCEPTION
      'Current Neon retention unexpectedly fits the Preview branch lower bound';
  END IF;
END
$capacity_assertion$;

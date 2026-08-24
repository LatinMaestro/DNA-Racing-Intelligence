\set ON_ERROR_STOP on

-- PostgreSQL 18 capacity proof for the current nine-file source profile after
-- migrations 0053-0058 move immutable Race Merge row/version evidence behind
-- private checksummed object manifests and compact it after aggregate publish.
--
-- The revised durable proof deliberately removes the relations that no longer
-- survive successful Race Merge publication:
--   * race_entry_source; and
--   * Race Merge dataset_version_record rows.
--
-- It then fixes the earlier deliberate understatement of race_entry cardinality.
-- Each audited Race Merge source row is one race-entry observation in the current
-- seven-file profile, so the durable race_entry lower bound uses all 2,691,579
-- audited Race Merge rows rather than only one entry per unique event.
--
-- The race_entry representative includes the 32-byte compact SHA-256 identity
-- that migration 0054 requires on every active accepted Race Merge entry. Optional
-- payout-format text and other nullable values remain omitted, so the result is
-- still a lower bound.
--
-- This proof excludes PostgreSQL page/index overhead, bounded receipts/manifests,
-- import/control rows, economics, Core/Arena materialisation, aggregate tables,
-- Discovery benchmarks, existing schema footprint and future Race Merge growth.
-- A durable lower-bound failure is therefore conclusive. Peak usage can never be
-- lower than the durable state, so the durable result also establishes a minimum
-- peak lower bound without pretending to estimate transient upload overhead.

WITH source_profile AS (
  SELECT
    2691579::bigint AS race_merge_rows,
    746648::bigint AS unique_race_events,
    18513::bigint AS core_details_rows,
    1474::bigint AS current_arena_rows,
    (512::bigint * 1024 * 1024) AS preview_branch_limit_bytes
), measured_rows AS (
  SELECT
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_event,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","source_event_id":"x","event_at":"2026-08-24T00:00:00Z","mode":"bike","distance":1,"gate_count":1,"source_import_batch_id":"33333333-3333-4333-8333-333333333333","created_at":"2026-08-24T00:00:00Z","updated_at":"2026-08-24T00:00:00Z","active_in_dataset":true}'::jsonb
    ))::bigint AS race_event_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_entry,
      jsonb_build_object(
        'id', '11111111-1111-4111-8111-111111111111',
        'owner_id', '22222222-2222-4222-8222-222222222222',
        'race_event_id', '33333333-3333-4333-8333-333333333333',
        'source_core_id', 'x',
        'gate_count', 1,
        'star_data_status', 'missing',
        'economic_data_status', 'unvalidated',
        'source_import_batch_id', '44444444-4444-4444-8444-444444444444',
        'source_fingerprint_sha256', decode(repeat('a', 64), 'hex'),
        'created_at', '2026-08-24T00:00:00Z',
        'updated_at', '2026-08-24T00:00:00Z',
        'active_in_dataset', true
      )
    ))::bigint AS race_entry_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.event_star_validation,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","race_event_id":"33333333-3333-4333-8333-333333333333","gate_count":1,"gold_assignment_count":0,"blue_assignment_count":0,"same_core_received_both":false,"validation_status":"valid","warning_codes":[],"refreshed_at":"2026-08-24T00:00:00Z","entry_count":1,"gold_source_core_ids":[],"blue_source_core_ids":[],"gold_data_complete":true,"blue_data_complete":true,"gold_assignment_opportunity":false,"blue_assignment_opportunity":false}'::jsonb
    ))::bigint AS event_star_validation_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.dataset_version_record,
      jsonb_build_object(
        'owner_id', '11111111-1111-4111-8111-111111111111',
        'dataset_version_id', '22222222-2222-4222-8222-222222222222',
        'source_type', 'core_details',
        'natural_key', 'x',
        'fingerprint_sha256', repeat('a', 64),
        'first_accepted_batch_id', '33333333-3333-4333-8333-333333333333',
        'created_at', '2026-08-24T00:00:00Z'
      )
    ))::bigint AS dataset_version_record_bytes
), projection AS (
  SELECT
    profile.*,
    measured.*,
    profile.unique_race_events * measured.race_event_bytes
      AS race_event_lower_bound_bytes,
    profile.race_merge_rows * measured.race_entry_bytes
      AS race_entry_lower_bound_bytes,
    profile.unique_race_events * measured.event_star_validation_bytes
      AS event_star_validation_lower_bound_bytes,
    (
      profile.core_details_rows
      + profile.current_arena_rows
    ) * measured.dataset_version_record_bytes
      AS dataset_version_record_lower_bound_bytes
  FROM source_profile profile
  CROSS JOIN measured_rows measured
), evidence AS (
  SELECT
    projection.*,
    race_event_lower_bound_bytes
      + race_entry_lower_bound_bytes
      + event_star_validation_lower_bound_bytes
      + dataset_version_record_lower_bound_bytes
      AS durable_post_publish_lower_bound_bytes
  FROM projection
)
SELECT
  race_merge_rows,
  unique_race_events,
  core_details_rows,
  current_arena_rows,
  race_event_bytes,
  race_entry_bytes,
  event_star_validation_bytes,
  dataset_version_record_bytes,
  race_event_lower_bound_bytes,
  race_entry_lower_bound_bytes,
  event_star_validation_lower_bound_bytes,
  dataset_version_record_lower_bound_bytes,
  durable_post_publish_lower_bound_bytes,
  durable_post_publish_lower_bound_bytes AS minimum_peak_lower_bound_bytes,
  preview_branch_limit_bytes,
  preview_branch_limit_bytes - durable_post_publish_lower_bound_bytes
    AS durable_headroom_bytes,
  preview_branch_limit_bytes - durable_post_publish_lower_bound_bytes
    AS minimum_peak_headroom_bytes,
  round(
    durable_post_publish_lower_bound_bytes::numeric
      / preview_branch_limit_bytes,
    3
  ) AS durable_limit_multiple,
  CASE
    WHEN durable_post_publish_lower_bound_bytes > preview_branch_limit_bytes
      THEN 'UNSAFE_POST_PUBLISH_NEON_RETENTION'
    ELSE 'LOWER_BOUND_DOES_NOT_PROVE_UNSAFE'
  END AS capacity_result
FROM evidence;

DO $capacity_assertion$
DECLARE
  v_race_merge_rows bigint := 2691579;
  v_unique_race_events bigint := 746648;
  v_core_details_rows bigint := 18513;
  v_current_arena_rows bigint := 1474;
  v_limit bigint := 512::bigint * 1024 * 1024;
  v_event_bytes bigint;
  v_entry_bytes bigint;
  v_star_bytes bigint;
  v_version_record_bytes bigint;
  v_projection bigint;
BEGIN
  SELECT
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_event,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","source_event_id":"x","event_at":"2026-08-24T00:00:00Z","mode":"bike","distance":1,"gate_count":1,"source_import_batch_id":"33333333-3333-4333-8333-333333333333","created_at":"2026-08-24T00:00:00Z","updated_at":"2026-08-24T00:00:00Z","active_in_dataset":true}'::jsonb
    ))::bigint,
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_entry,
      jsonb_build_object(
        'id', '11111111-1111-4111-8111-111111111111',
        'owner_id', '22222222-2222-4222-8222-222222222222',
        'race_event_id', '33333333-3333-4333-8333-333333333333',
        'source_core_id', 'x',
        'gate_count', 1,
        'star_data_status', 'missing',
        'economic_data_status', 'unvalidated',
        'source_import_batch_id', '44444444-4444-4444-8444-444444444444',
        'source_fingerprint_sha256', decode(repeat('a', 64), 'hex'),
        'created_at', '2026-08-24T00:00:00Z',
        'updated_at', '2026-08-24T00:00:00Z',
        'active_in_dataset', true
      )
    ))::bigint,
    pg_column_size(jsonb_populate_record(
      NULL::dna.event_star_validation,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","race_event_id":"33333333-3333-4333-8333-333333333333","gate_count":1,"gold_assignment_count":0,"blue_assignment_count":0,"same_core_received_both":false,"validation_status":"valid","warning_codes":[],"refreshed_at":"2026-08-24T00:00:00Z","entry_count":1,"gold_source_core_ids":[],"blue_source_core_ids":[],"gold_data_complete":true,"blue_data_complete":true,"gold_assignment_opportunity":false,"blue_assignment_opportunity":false}'::jsonb
    ))::bigint,
    pg_column_size(jsonb_populate_record(
      NULL::dna.dataset_version_record,
      jsonb_build_object(
        'owner_id', '11111111-1111-4111-8111-111111111111',
        'dataset_version_id', '22222222-2222-4222-8222-222222222222',
        'source_type', 'core_details',
        'natural_key', 'x',
        'fingerprint_sha256', repeat('a', 64),
        'first_accepted_batch_id', '33333333-3333-4333-8333-333333333333',
        'created_at', '2026-08-24T00:00:00Z'
      )
    ))::bigint
  INTO
    v_event_bytes,
    v_entry_bytes,
    v_star_bytes,
    v_version_record_bytes;

  IF v_event_bytes <> 129
     OR v_star_bytes <> 158
     OR v_version_record_bytes <> 160 THEN
    RAISE EXCEPTION
      'Revised row measurement changed: event %, star %, version %',
      v_event_bytes,
      v_star_bytes,
      v_version_record_bytes;
  END IF;

  IF v_entry_bytes <= 137 THEN
    RAISE EXCEPTION
      'Race entry capacity fixture omitted compact SHA identity: %', v_entry_bytes;
  END IF;

  v_projection :=
    v_unique_race_events * v_event_bytes
    + v_race_merge_rows * v_entry_bytes
    + v_unique_race_events * v_star_bytes
    + (v_core_details_rows + v_current_arena_rows) * v_version_record_bytes;

  IF v_projection <= v_limit THEN
    RAISE EXCEPTION
      'Revised durable Race Merge lower bound unexpectedly fits Preview: %',
      v_projection;
  END IF;
END
$capacity_assertion$;

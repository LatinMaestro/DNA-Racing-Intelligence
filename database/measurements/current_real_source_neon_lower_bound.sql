\set ON_ERROR_STOP on

-- PostgreSQL 18 capacity proof for the current real Race/Core/Arena source shape
-- after migration 0067 removes normalized race_entry detail after exact
-- archive-backed aggregate publication.
--
-- The proof now distinguishes:
--   1. durable post-publication Neon state; and
--   2. the minimum sequential Race-import peak while one spreadsheet segment is
--      accepted/materialized before the existing evidence/provenance/entry
--      compaction steps can remove its transient per-row ledgers.
--
-- The seven current Race segment row counts are privacy-safe aggregate evidence
-- from the owner's audited exports. Cumulative unique-event counts for segments
-- 1-5 are reproduced from the source exports; segment 6 and 7 cumulative counts
-- are the audited six-file and seven-file totals.
--
-- This remains a lower bound. It deliberately excludes PostgreSQL heap/index
-- overhead, aggregate/read-model rows, economics, receipts/manifests/control
-- rows, Core/Arena materialization, and optional populated text fields. If this
-- lower bound exceeds the protected branch limit, the result is conclusive.

WITH race_segments(segment_number, race_rows, cumulative_unique_events) AS (
  VALUES
    (1, 252202::bigint,  69666::bigint),
    (2, 283637::bigint, 174932::bigint),
    (3, 504532::bigint, 300209::bigint),
    (4, 491315::bigint, 412051::bigint),
    (5, 503788::bigint, 545834::bigint),
    (6, 501236::bigint, 695901::bigint),
    (7, 154869::bigint, 746648::bigint)
), source_profile AS (
  SELECT
    (SELECT sum(race_rows) FROM race_segments)::bigint AS race_merge_rows,
    (SELECT max(cumulative_unique_events) FROM race_segments)::bigint
      AS unique_race_events,
    18513::bigint AS core_details_rows,
    1474::bigint AS current_arena_rows,
    (SELECT max(race_rows) FROM race_segments)::bigint
      AS maximum_observed_race_segment_rows,
    (512::bigint * 1024 * 1024) AS preview_branch_limit_bytes
), measured_rows AS (
  SELECT
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_event,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","source_event_id":"x","event_at":"2026-08-24T00:00:00Z","mode":"bike","distance":1,"gate_count":1,"source_import_batch_id":"33333333-3333-4333-8333-333333333333","created_at":"2026-08-24T00:00:00Z","updated_at":"2026-08-24T00:00:00Z","active_in_dataset":true}'::jsonb
    ))::bigint AS race_event_bytes,
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
    ))::bigint AS current_state_version_record_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.dataset_staged_record,
      jsonb_build_object(
        'owner_id', '11111111-1111-4111-8111-111111111111',
        'import_batch_id', '22222222-2222-4222-8222-222222222222',
        'source_row_number', 1,
        'natural_key', 'x',
        'fingerprint_sha256', repeat('a', 64),
        'status', 'ready',
        'issue_codes', jsonb_build_array(),
        'created_at', '2026-08-24T00:00:00Z'
      )
    ))::bigint AS dataset_staged_record_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.normalized_race_staged_fact,
      jsonb_build_object(
        'owner_id', '11111111-1111-4111-8111-111111111111',
        'import_batch_id', '22222222-2222-4222-8222-222222222222',
        'source_row_number', 1,
        'source_event_id', 'x',
        'event_at', '2026-08-24T00:00:00Z',
        'mode', 'bike',
        'distance', 1,
        'source_core_id', 'x',
        'gate_count', 1,
        'raw_gold_star', 'false',
        'raw_blue_star', 'false',
        'star_data_status', 'complete',
        'finish_position', 1,
        'elapsed_time_source_value', '1',
        'economic_data_status', 'ready',
        'race_asset', 'DEZ',
        'entry_fee_amount', 0,
        'gross_payout_amount', 0,
        'created_at', '2026-08-24T00:00:00Z'
      )
    ))::bigint AS normalized_race_staged_fact_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.dataset_record_contribution,
      jsonb_build_object(
        'owner_id', '11111111-1111-4111-8111-111111111111',
        'source_type', 'race_merge',
        'natural_key', 'x',
        'import_batch_id', '22222222-2222-4222-8222-222222222222',
        'fingerprint_sha256', repeat('a', 64),
        'created_at', '2026-08-24T00:00:00Z'
      )
    ))::bigint AS dataset_record_contribution_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.dataset_version_record,
      jsonb_build_object(
        'owner_id', '11111111-1111-4111-8111-111111111111',
        'dataset_version_id', '22222222-2222-4222-8222-222222222222',
        'source_type', 'race_merge',
        'natural_key', 'x',
        'fingerprint_sha256', repeat('a', 64),
        'first_accepted_batch_id', '33333333-3333-4333-8333-333333333333',
        'created_at', '2026-08-24T00:00:00Z'
      )
    ))::bigint AS race_version_record_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_entry,
      jsonb_build_object(
        'id', '11111111-1111-4111-8111-111111111111',
        'owner_id', '22222222-2222-4222-8222-222222222222',
        'race_event_id', '33333333-3333-4333-8333-333333333333',
        'source_core_id', 'x',
        'gate_count', 1,
        'star_data_status', 'complete',
        'finish_position', 1,
        'economic_data_status', 'unvalidated',
        'source_import_batch_id', '44444444-4444-4444-8444-444444444444',
        'source_fingerprint_sha256', decode(repeat('a', 64), 'hex'),
        'created_at', '2026-08-24T00:00:00Z',
        'updated_at', '2026-08-24T00:00:00Z',
        'active_in_dataset', true
      )
    ))::bigint AS race_entry_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_entry_source,
      jsonb_build_object(
        'id', '11111111-1111-4111-8111-111111111111',
        'owner_id', '22222222-2222-4222-8222-222222222222',
        'race_entry_id', '33333333-3333-4333-8333-333333333333',
        'import_batch_id', '44444444-4444-4444-8444-444444444444',
        'source_row_number', 1,
        'source_row_checksum', repeat('a', 64),
        'raw_gold_star', 'false',
        'raw_blue_star', 'false',
        'is_selected_fact', true,
        'raw_elapsed_time', '1',
        'created_at', '2026-08-24T00:00:00Z'
      )
    ))::bigint AS race_entry_source_bytes
), row_evidence AS (
  SELECT
    measured.*,
    dataset_staged_record_bytes
      + normalized_race_staged_fact_bytes
      + dataset_record_contribution_bytes
      + race_version_record_bytes
      + race_entry_bytes
      + race_entry_source_bytes
      AS transient_race_bytes_per_source_row
  FROM measured_rows measured
), durable AS (
  SELECT
    profile.*,
    row_evidence.*,
    profile.unique_race_events * row_evidence.race_event_bytes
      AS race_event_lower_bound_bytes,
    profile.unique_race_events * row_evidence.event_star_validation_bytes
      AS event_star_validation_lower_bound_bytes,
    (profile.core_details_rows + profile.current_arena_rows)
      * row_evidence.current_state_version_record_bytes
      AS current_state_version_record_lower_bound_bytes
  FROM source_profile profile
  CROSS JOIN row_evidence
), durable_evidence AS (
  SELECT
    durable.*,
    race_event_lower_bound_bytes
      + event_star_validation_lower_bound_bytes
      + current_state_version_record_lower_bound_bytes
      AS durable_post_publish_lower_bound_bytes
  FROM durable
), segment_peaks AS (
  SELECT
    segment.segment_number,
    segment.race_rows,
    segment.cumulative_unique_events,
    segment.cumulative_unique_events * evidence.race_event_bytes
      + segment.cumulative_unique_events * evidence.event_star_validation_bytes
      + segment.race_rows * evidence.transient_race_bytes_per_source_row
      AS initial_sequential_peak_lower_bound_bytes
  FROM race_segments segment
  CROSS JOIN durable_evidence evidence
), peak_evidence AS (
  SELECT
    evidence.*,
    peak.segment_number AS initial_peak_segment_number,
    peak.race_rows AS initial_peak_segment_rows,
    peak.initial_sequential_peak_lower_bound_bytes,
    evidence.durable_post_publish_lower_bound_bytes
      + evidence.maximum_observed_race_segment_rows
        * evidence.transient_race_bytes_per_source_row
      AS full_rolling_segment_peak_lower_bound_bytes
  FROM durable_evidence evidence
  CROSS JOIN LATERAL (
    SELECT *
    FROM segment_peaks
    ORDER BY initial_sequential_peak_lower_bound_bytes DESC
    LIMIT 1
  ) peak
)
SELECT
  race_merge_rows,
  unique_race_events,
  core_details_rows,
  current_arena_rows,
  maximum_observed_race_segment_rows,
  race_event_bytes,
  event_star_validation_bytes,
  current_state_version_record_bytes,
  dataset_staged_record_bytes,
  normalized_race_staged_fact_bytes,
  dataset_record_contribution_bytes,
  race_version_record_bytes,
  race_entry_bytes,
  race_entry_source_bytes,
  transient_race_bytes_per_source_row,
  race_event_lower_bound_bytes,
  event_star_validation_lower_bound_bytes,
  current_state_version_record_lower_bound_bytes,
  durable_post_publish_lower_bound_bytes,
  initial_peak_segment_number,
  initial_peak_segment_rows,
  initial_sequential_peak_lower_bound_bytes,
  full_rolling_segment_peak_lower_bound_bytes,
  preview_branch_limit_bytes,
  preview_branch_limit_bytes - durable_post_publish_lower_bound_bytes
    AS durable_headroom_bytes,
  preview_branch_limit_bytes - initial_sequential_peak_lower_bound_bytes
    AS initial_sequential_peak_headroom_bytes,
  preview_branch_limit_bytes - full_rolling_segment_peak_lower_bound_bytes
    AS full_rolling_segment_peak_headroom_bytes,
  CASE
    WHEN durable_post_publish_lower_bound_bytes > preview_branch_limit_bytes
      THEN 'UNSAFE_POST_PUBLISH_NEON_RETENTION'
    WHEN initial_sequential_peak_lower_bound_bytes > preview_branch_limit_bytes
      THEN 'UNSAFE_CURRENT_SEQUENTIAL_RACE_PEAK'
    WHEN full_rolling_segment_peak_lower_bound_bytes > preview_branch_limit_bytes
      THEN 'UNSAFE_FULL_ROLLING_SEGMENT_PEAK'
    ELSE 'LOWER_BOUND_DOES_NOT_PROVE_UNSAFE'
  END AS capacity_result
FROM peak_evidence;

DO $capacity_assertion$
DECLARE
  v_race_rows bigint;
  v_unique_events bigint;
  v_max_segment_rows bigint;
BEGIN
  SELECT sum(race_rows), max(cumulative_unique_events), max(race_rows)
  INTO v_race_rows, v_unique_events, v_max_segment_rows
  FROM (
    VALUES
      (1, 252202::bigint,  69666::bigint),
      (2, 283637::bigint, 174932::bigint),
      (3, 504532::bigint, 300209::bigint),
      (4, 491315::bigint, 412051::bigint),
      (5, 503788::bigint, 545834::bigint),
      (6, 501236::bigint, 695901::bigint),
      (7, 154869::bigint, 746648::bigint)
  ) AS segment(segment_number, race_rows, cumulative_unique_events);

  IF v_race_rows <> 2691579
     OR v_unique_events <> 746648
     OR v_max_segment_rows <> 504532 THEN
    RAISE EXCEPTION
      'audited Race segment profile changed unexpectedly: rows %, events %, max %',
      v_race_rows, v_unique_events, v_max_segment_rows;
  END IF;
END
$capacity_assertion$;

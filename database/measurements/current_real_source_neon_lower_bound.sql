\set ON_ERROR_STOP on

-- PostgreSQL 18 post-compaction capacity proof for the current nine-file source
-- profile. Migrations 0047-0052 remove transient staged/contribution ledgers
-- after accepted evidence is safely externalised, so this measurement focuses on
-- durable Neon rows that still survive successful activation and compaction.
--
-- The projection is deliberately conservative. It counts only:
--   * one race_entry_source row for each accepted Race Merge source row;
--   * one race_event row per audited unique event;
--   * one event_star_validation row per audited unique event;
--   * only ONE race_entry per event, even though real events have multiple gates;
--   * only ONE Race Merge dataset_version_record per event, plus current Core
--     Details and Arena rows, even though the real natural-key count is much larger.
--
-- It excludes PostgreSQL page overhead, indexes, import/control rows, economics,
-- Core/Arena materialisation, performance/star/payout aggregates, Discovery
-- benchmarks and future Race Merge growth. A failure here is therefore conclusive.

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
      NULL::dna.race_entry_source,
      jsonb_build_object(
        'id', '11111111-1111-4111-8111-111111111111',
        'owner_id', '22222222-2222-4222-8222-222222222222',
        'race_entry_id', '33333333-3333-4333-8333-333333333333',
        'import_batch_id', '44444444-4444-4444-8444-444444444444',
        'source_row_number', 1,
        'source_row_checksum', repeat('a', 64),
        'raw_gold_star', '',
        'raw_blue_star', '',
        'is_selected_fact', true,
        'created_at', '2026-08-24T00:00:00Z',
        'raw_elapsed_time', '1'
      )
    ))::bigint AS race_entry_source_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_event,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","source_event_id":"x","event_at":"2026-08-24T00:00:00Z","mode":"bike","distance":1,"gate_count":1,"source_import_batch_id":"33333333-3333-4333-8333-333333333333","created_at":"2026-08-24T00:00:00Z","updated_at":"2026-08-24T00:00:00Z","active_in_dataset":true}'::jsonb
    ))::bigint AS race_event_bytes,
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_entry,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","race_event_id":"33333333-3333-4333-8333-333333333333","source_core_id":"x","gate_count":1,"star_data_status":"missing","economic_data_status":"unvalidated","source_import_batch_id":"44444444-4444-4444-8444-444444444444","created_at":"2026-08-24T00:00:00Z","updated_at":"2026-08-24T00:00:00Z","active_in_dataset":true}'::jsonb
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
        'source_type', 'race_merge',
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
    profile.race_merge_rows * measured.race_entry_source_bytes
      AS race_entry_source_lower_bound_bytes,
    profile.unique_race_events * measured.race_event_bytes
      AS race_event_lower_bound_bytes,
    profile.unique_race_events * measured.race_entry_bytes
      AS race_entry_lower_bound_bytes,
    profile.unique_race_events * measured.event_star_validation_bytes
      AS event_star_validation_lower_bound_bytes,
    (
      profile.unique_race_events
      + profile.core_details_rows
      + profile.current_arena_rows
    ) * measured.dataset_version_record_bytes
      AS dataset_version_record_lower_bound_bytes
  FROM source_profile profile
  CROSS JOIN measured_rows measured
), evidence AS (
  SELECT
    projection.*,
    race_entry_source_lower_bound_bytes
      + race_event_lower_bound_bytes
      + race_entry_lower_bound_bytes
      + event_star_validation_lower_bound_bytes
      + dataset_version_record_lower_bound_bytes
      AS durable_post_compaction_lower_bound_bytes
  FROM projection
)
SELECT
  race_merge_rows,
  unique_race_events,
  core_details_rows,
  current_arena_rows,
  race_entry_source_bytes,
  race_event_bytes,
  race_entry_bytes,
  event_star_validation_bytes,
  dataset_version_record_bytes,
  race_entry_source_lower_bound_bytes,
  race_event_lower_bound_bytes,
  race_entry_lower_bound_bytes,
  event_star_validation_lower_bound_bytes,
  dataset_version_record_lower_bound_bytes,
  durable_post_compaction_lower_bound_bytes,
  preview_branch_limit_bytes,
  durable_post_compaction_lower_bound_bytes - preview_branch_limit_bytes
    AS minimum_bytes_over_limit,
  round(
    durable_post_compaction_lower_bound_bytes::numeric
      / preview_branch_limit_bytes,
    3
  ) AS lower_bound_limit_multiple,
  CASE
    WHEN durable_post_compaction_lower_bound_bytes > preview_branch_limit_bytes
      THEN 'UNSAFE_POST_COMPACTION_NEON_RETENTION'
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
  v_source_bytes bigint;
  v_event_bytes bigint;
  v_entry_bytes bigint;
  v_star_bytes bigint;
  v_version_record_bytes bigint;
  v_projection bigint;
BEGIN
  SELECT
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_entry_source,
      jsonb_build_object(
        'id', '11111111-1111-4111-8111-111111111111',
        'owner_id', '22222222-2222-4222-8222-222222222222',
        'race_entry_id', '33333333-3333-4333-8333-333333333333',
        'import_batch_id', '44444444-4444-4444-8444-444444444444',
        'source_row_number', 1,
        'source_row_checksum', repeat('a', 64),
        'raw_gold_star', '',
        'raw_blue_star', '',
        'is_selected_fact', true,
        'created_at', '2026-08-24T00:00:00Z',
        'raw_elapsed_time', '1'
      )
    ))::bigint,
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_event,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","source_event_id":"x","event_at":"2026-08-24T00:00:00Z","mode":"bike","distance":1,"gate_count":1,"source_import_batch_id":"33333333-3333-4333-8333-333333333333","created_at":"2026-08-24T00:00:00Z","updated_at":"2026-08-24T00:00:00Z","active_in_dataset":true}'::jsonb
    ))::bigint,
    pg_column_size(jsonb_populate_record(
      NULL::dna.race_entry,
      '{"id":"11111111-1111-4111-8111-111111111111","owner_id":"22222222-2222-4222-8222-222222222222","race_event_id":"33333333-3333-4333-8333-333333333333","source_core_id":"x","gate_count":1,"star_data_status":"missing","economic_data_status":"unvalidated","source_import_batch_id":"44444444-4444-4444-8444-444444444444","created_at":"2026-08-24T00:00:00Z","updated_at":"2026-08-24T00:00:00Z","active_in_dataset":true}'::jsonb
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
        'source_type', 'race_merge',
        'natural_key', 'x',
        'fingerprint_sha256', repeat('a', 64),
        'first_accepted_batch_id', '33333333-3333-4333-8333-333333333333',
        'created_at', '2026-08-24T00:00:00Z'
      )
    ))::bigint
  INTO
    v_source_bytes,
    v_event_bytes,
    v_entry_bytes,
    v_star_bytes,
    v_version_record_bytes;

  IF v_source_bytes <> 186
     OR v_event_bytes <> 129
     OR v_entry_bytes <> 137
     OR v_star_bytes <> 158
     OR v_version_record_bytes <> 160 THEN
    RAISE EXCEPTION
      'Post-compaction row measurement changed: source %, event %, entry %, star %, version %',
      v_source_bytes,
      v_event_bytes,
      v_entry_bytes,
      v_star_bytes,
      v_version_record_bytes;
  END IF;

  v_projection :=
    v_race_merge_rows * v_source_bytes
    + v_unique_race_events * v_event_bytes
    + v_unique_race_events * v_entry_bytes
    + v_unique_race_events * v_star_bytes
    + (v_unique_race_events + v_core_details_rows + v_current_arena_rows)
      * v_version_record_bytes;

  IF v_projection <> 939874046 THEN
    RAISE EXCEPTION
      'Post-compaction real-source projection changed: %', v_projection;
  END IF;

  IF v_projection <= v_limit THEN
    RAISE EXCEPTION
      'Current durable post-compaction Neon lower bound unexpectedly fits Preview';
  END IF;
END
$capacity_assertion$;

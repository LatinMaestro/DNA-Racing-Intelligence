BEGIN;

SET LOCAL app.owner_id = '60000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('60000000-0000-4000-8000-000000000001', 'archive-aggregate-owner'),
  ('60000000-0000-4000-8000-000000000002', 'archive-aggregate-other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '60000000-0000-4000-8000-000000000010',
  '60000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-race.csv', repeat('a', 64),
  'utf_8', 'race_merge_v1', 'accepted',
  '2026-08-25T00:00:00Z', '2026-08-25T00:01:00Z',
  '2026-08-24T23:00:00Z', '2026-08-24T23:30:00Z',
  '2026-08-24T23:30:00Z', 2, 2, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES (
  '60000000-0000-4000-8000-000000000020',
  '60000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '60000000-0000-4000-8000-000000000010',
  '2026-08-25T00:01:00Z', '2026-08-24T23:30:00Z', NULL, true
);

INSERT INTO dna.dataset_version_evidence_receipt (
  owner_id, dataset_version_id, import_batch_id, source_type,
  evidence_kind, evidence_partition_count, evidence_row_count,
  evidence_byte_size, sealed_at
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000020',
  '60000000-0000-4000-8000-000000000010',
  'race_merge', 'staged_rows', 1, 2, 256, '2026-08-25T00:02:00Z'
);

INSERT INTO dna.race_archive_core_locator_receipt (
  owner_id, dataset_version_id, import_batch_id, locator_set_sha256,
  core_locator_count, ready_row_count, partition_reference_count, built_at
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000020',
  '60000000-0000-4000-8000-000000000010',
  repeat('b', 64), 1, 2, 1, '2026-08-25T00:02:00Z'
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
) VALUES (
  '60000000-0000-4000-8000-000000000030',
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000020',
  'queued'
);

DO $claim$
DECLARE
  v_claim record;
BEGIN
  SELECT * INTO STRICT v_claim
  FROM dna.claim_pro_league_aggregate_refresh(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000030',
    'archive-publisher',
    '2026-08-25T00:03:00Z',
    '2099-08-25T00:03:00Z'
  );
  IF v_claim.status <> 'claimed' THEN
    RAISE EXCEPTION 'archive aggregate publication claim failed';
  END IF;
END
$claim$;

INSERT INTO dna.core_performance_profile (
  owner_id, source_core_id, mode, distance, data_current_through, race_count,
  best_milliseconds, median_milliseconds, mean_milliseconds,
  trimmed_mean_milliseconds, standard_deviation_milliseconds,
  interquartile_range_milliseconds, best_metres_per_second,
  median_metres_per_second, refreshed_at
) VALUES (
  '60000000-0000-4000-8000-000000000001', 'old-core', 'bike', 900,
  '2026-08-24T00:00:00Z', 1, 12000, 12000, 12000, 12000, 0, 0,
  75, 75, '2026-08-24T01:00:00Z'
);

INSERT INTO dna.discovery_exact_distance_benchmark (
  owner_id, mode, distance, data_current_through, race_entry_count,
  winning_entry_count, top_three_entry_count, winning_p25_milliseconds,
  winning_median_milliseconds, winning_p75_milliseconds,
  top_three_p25_milliseconds, top_three_median_milliseconds,
  top_three_p75_milliseconds, refreshed_at
) VALUES (
  '60000000-0000-4000-8000-000000000001', 'bike', 900,
  '2026-08-24T00:00:00Z', 1, 1, 1, 12000, 12000, 12000,
  12000, 12000, 12000, '2026-08-24T01:00:00Z'
);

INSERT INTO dna.core_payout_format_profile (
  owner_id, source_core_id, mode, payout_format_key, payout_format_label,
  data_current_through, first_event_at, race_count, win_count,
  top_three_count, exact_distance_count, timed_race_count, refreshed_at
) VALUES (
  '60000000-0000-4000-8000-000000000001', 'old-core', 'bike',
  'top 3', 'Top 3', '2026-08-24T00:00:00Z', '2026-08-24T00:00:00Z',
  1, 1, 1, 1, 1, '2026-08-24T01:00:00Z'
);

INSERT INTO dna.core_star_profile (
  owner_id, source_core_id, mode, distance, data_current_through, race_count,
  complete_star_data_race_count, partial_star_data_race_count,
  missing_star_data_race_count, invalid_star_data_race_count,
  gold_eligible_race_count, gold_assignment_opportunity_count,
  gold_received_count, gold_negative_opportunity_count,
  gold_eligible_no_assignment_count, gold_ineligible_assignment_count,
  gold_excluded_anomaly_count, blue_assignment_opportunity_count,
  blue_received_count, blue_negative_opportunity_count, blue_no_assignment_count,
  blue_excluded_anomaly_count, same_core_received_both_count, refreshed_at
) VALUES (
  '60000000-0000-4000-8000-000000000001', 'old-core', 'bike', 900,
  '2026-08-24T00:00:00Z', 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0,
  1, 1, 0, 0, 0, 1, '2026-08-24T01:00:00Z'
);

DO $privileges$
DECLARE
  v_stage_rls boolean;
  v_stage_force boolean;
  v_row_rls boolean;
  v_row_force boolean;
  v_receipt_rls boolean;
  v_receipt_force boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO v_stage_rls, v_stage_force
  FROM pg_catalog.pg_class
  WHERE oid = 'dna.race_archive_aggregate_publication_stage'::regclass;
  SELECT relrowsecurity, relforcerowsecurity
  INTO v_row_rls, v_row_force
  FROM pg_catalog.pg_class
  WHERE oid = 'dna.race_archive_aggregate_publication_stage_row'::regclass;
  SELECT relrowsecurity, relforcerowsecurity
  INTO v_receipt_rls, v_receipt_force
  FROM pg_catalog.pg_class
  WHERE oid = 'dna.race_archive_aggregate_publication_receipt'::regclass;

  IF NOT v_stage_rls OR NOT v_stage_force
     OR NOT v_row_rls OR NOT v_row_force
     OR NOT v_receipt_rls OR NOT v_receipt_force THEN
    RAISE EXCEPTION 'Race archive aggregate publication tables must use forced RLS';
  END IF;

  IF has_table_privilege(
    'dna_app_runtime', 'dna.race_archive_aggregate_publication_stage',
    'SELECT,INSERT,UPDATE,DELETE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.race_archive_aggregate_publication_stage_row',
    'SELECT,INSERT,UPDATE,DELETE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.race_archive_aggregate_publication_receipt',
    'SELECT,INSERT,UPDATE,DELETE'
  ) THEN
    RAISE EXCEPTION 'runtime must not have direct archive aggregate table DML';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.stage_race_archive_aggregate_rows(uuid,uuid,text,text,integer,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.publish_race_archive_aggregates(uuid,uuid,text,character,bigint,bigint,bigint,bigint,bigint,bigint,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime archive aggregate publication functions are unavailable';
  END IF;
END
$privileges$;

DO $stage_and_fail_closed$
DECLARE
  v_source_hash character(64);
  v_status text;
BEGIN
  SELECT processing.source_version_set_sha256 INTO STRICT v_source_hash
  FROM dna.aggregate_refresh_processing processing
  WHERE processing.owner_id = '60000000-0000-4000-8000-000000000001'
    AND processing.refresh_id = '60000000-0000-4000-8000-000000000030';

  SELECT dna.begin_race_archive_aggregate_publication(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000030',
    '60000000-0000-4000-8000-000000000020',
    'archive-publisher', v_source_hash, '2026-08-25T00:04:00Z'
  ) INTO v_status;
  IF v_status <> 'staging' THEN
    RAISE EXCEPTION 'archive aggregate publication did not enter staging';
  END IF;

  PERFORM dna.stage_race_archive_aggregate_rows(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000030',
    'archive-publisher', 'core_performance', 0,
    '[{
      "source_core_id":"core-1","mode":"bike","distance":1000,
      "data_current_through":"2026-08-24T23:30:00Z","race_count":2,
      "best_milliseconds":10000,"median_milliseconds":10500,
      "mean_milliseconds":10500,"trimmed_mean_milliseconds":10500,
      "standard_deviation_milliseconds":500,
      "interquartile_range_milliseconds":500,
      "best_metres_per_second":100,"median_metres_per_second":95.238095
    }]'::jsonb
  );

  BEGIN
    PERFORM * FROM dna.publish_race_archive_aggregates(
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000030',
      'archive-publisher', repeat('c', 64)::character(64),
      1, 2, 1, 1, 1, 1, '2026-08-25T00:05:00Z'
    );
    RAISE EXCEPTION 'incomplete archive aggregate staging was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete archive aggregate staging was published' THEN RAISE; END IF;
    IF position('staged row counts do not match' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM dna.core_performance_profile
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND source_core_id = 'old-core'
  ) OR EXISTS (
    SELECT 1 FROM dna.race_archive_aggregate_publication_receipt
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND refresh_id = '60000000-0000-4000-8000-000000000030'
  ) THEN
    RAISE EXCEPTION 'failed archive publication changed visible read models';
  END IF;
END
$stage_and_fail_closed$;

SELECT dna.stage_race_archive_aggregate_rows(
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000030',
  'archive-publisher', 'discovery_benchmark', 0,
  '[{
    "mode":"bike","distance_metres":1000,
    "data_current_through":"2026-08-24T23:30:00Z","race_entry_count":2,
    "winning_entry_count":1,"top_three_entry_count":2,
    "winning_p25_milliseconds":10000,"winning_median_milliseconds":10000,
    "winning_p75_milliseconds":10000,"top_three_p25_milliseconds":10250,
    "top_three_median_milliseconds":10500,"top_three_p75_milliseconds":10750
  }]'::jsonb
);

SELECT dna.stage_race_archive_aggregate_rows(
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000030',
  'archive-publisher', 'payout_format', 0,
  '[{
    "source_core_id":"core-1","mode":"bike",
    "payout_format_key":"top 3","payout_format_label":"Top 3",
    "data_current_through":"2026-08-24T23:30:00Z",
    "first_event_at":"2026-08-24T23:00:00Z","race_count":2,
    "win_count":1,"top_three_count":2,"exact_distance_count":1,
    "timed_race_count":2
  }]'::jsonb
);

SELECT dna.stage_race_archive_aggregate_rows(
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000030',
  'archive-publisher', 'core_star_profile', 0,
  '[{
    "source_core_id":"core-1","mode":"bike","distance":1000,
    "data_current_through":"2026-08-24T23:30:00Z","race_count":2,
    "complete_star_data_race_count":2,"partial_star_data_race_count":0,
    "missing_star_data_race_count":0,"invalid_star_data_race_count":0,
    "gold_eligible_race_count":2,"gold_assignment_opportunity_count":2,
    "gold_received_count":1,"gold_negative_opportunity_count":1,
    "gold_eligible_no_assignment_count":0,"gold_ineligible_assignment_count":0,
    "gold_excluded_anomaly_count":0,"blue_assignment_opportunity_count":2,
    "blue_received_count":1,"blue_negative_opportunity_count":1,
    "blue_no_assignment_count":0,"blue_excluded_anomaly_count":0,
    "same_core_received_both_count":1
  }]'::jsonb
);

DO $publish$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.publish_race_archive_aggregates(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000030',
    'archive-publisher', repeat('c', 64)::character(64),
    1, 2, 1, 1, 1, 1, '2026-08-25T00:05:00Z'
  );
  IF v_result.status <> 'published' OR v_result.materialized_row_count <> 5 THEN
    RAISE EXCEPTION 'archive aggregate publication receipt is invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.core_performance_profile
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND source_core_id = 'old-core'
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.core_performance_profile
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND source_core_id = 'core-1' AND race_count = 2
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.discovery_exact_distance_benchmark
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND mode = 'bike' AND distance = 1000 AND race_entry_count = 2
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.core_payout_format_profile
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND source_core_id = 'core-1' AND payout_format_key = 'top 3'
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.core_star_profile
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND source_core_id = 'core-1' AND gold_received_count = 1
  ) THEN
    RAISE EXCEPTION 'archive aggregate publication did not atomically replace read models';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.race_archive_aggregate_publication_receipt
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND refresh_id = '60000000-0000-4000-8000-000000000030'
      AND aggregate_family_count = 4
      AND validated_event_count = 1
      AND accepted_format_entry_count = 2
      AND materialized_row_count = 5
  ) OR EXISTS (
    SELECT 1 FROM dna.race_archive_aggregate_publication_stage
    WHERE owner_id = '60000000-0000-4000-8000-000000000001'
      AND refresh_id = '60000000-0000-4000-8000-000000000030'
  ) THEN
    RAISE EXCEPTION 'archive aggregate publication did not seal and clear staging';
  END IF;
END
$publish$;

DO $replay$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.publish_race_archive_aggregates(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000030',
    'archive-publisher', repeat('c', 64)::character(64),
    1, 2, 1, 1, 1, 1, '2026-08-25T00:06:00Z'
  );
  IF v_result.status <> 'existing' OR v_result.materialized_row_count <> 5 THEN
    RAISE EXCEPTION 'exact archive aggregate publication replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.publish_race_archive_aggregates(
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000030',
      'archive-publisher', repeat('d', 64)::character(64),
      1, 2, 1, 1, 1, 1, '2026-08-25T00:06:00Z'
    );
    RAISE EXCEPTION 'conflicting archive aggregate replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting archive aggregate replay was accepted' THEN RAISE; END IF;
    IF position('replay conflict' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$replay$;

SELECT set_config(
  'app.owner_id', '60000000-0000-4000-8000-000000000002', true
);

DO $owner_isolation$
BEGIN
  BEGIN
    PERFORM dna.begin_race_archive_aggregate_publication(
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000030',
      '60000000-0000-4000-8000-000000000020',
      'archive-publisher', repeat('e', 64)::character(64),
      '2026-08-25T00:07:00Z'
    );
    RAISE EXCEPTION 'cross-owner archive aggregate publication was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner archive aggregate publication was accepted' THEN RAISE; END IF;
    IF position('owner-scoped Race archive aggregate publication denied' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$owner_isolation$;

ROLLBACK;
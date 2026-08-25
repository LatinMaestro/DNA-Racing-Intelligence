BEGIN;

SET LOCAL app.owner_id = '61000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('61000000-0000-4000-8000-000000000001', 'archive-reuse-owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
(
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000001',
  'race_merge', 'race.csv', repeat('a',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-25T00:00:00Z', '2026-08-25T00:01:00Z',
  '2026-08-24T00:00:00Z', '2026-08-24T23:00:00Z',
  '2026-08-24T23:00:00Z', 2, 2, 0, 0
),
(
  '61000000-0000-4000-8000-000000000011',
  '61000000-0000-4000-8000-000000000001',
  'core_details', 'cores.csv', repeat('b',64), 'utf_8', 'core_details_v1',
  'accepted', '2026-08-25T00:10:00Z', '2026-08-25T00:11:00Z',
  NULL, NULL, NULL, 1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES
(
  '61000000-0000-4000-8000-000000000020',
  '61000000-0000-4000-8000-000000000001', 'race_merge', 1,
  '61000000-0000-4000-8000-000000000010',
  '2026-08-25T00:02:00Z', '2026-08-24T23:00:00Z',
  '2026-08-25T00:05:00Z', true
),
(
  '61000000-0000-4000-8000-000000000021',
  '61000000-0000-4000-8000-000000000001', 'core_details', 1,
  '61000000-0000-4000-8000-000000000011',
  '2026-08-25T00:12:00Z', NULL, NULL, true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at, completed_at,
  affected_record_count
) VALUES
(
  '61000000-0000-4000-8000-000000000030',
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000020',
  'completed', '2026-08-25T00:03:00Z', '2026-08-25T00:05:00Z', 6
),
(
  '61000000-0000-4000-8000-000000000031',
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000021', 'queued', NULL, NULL, NULL
);

INSERT INTO dna.core_performance_profile (
  owner_id, source_core_id, mode, distance, data_current_through, race_count,
  best_milliseconds, median_milliseconds, mean_milliseconds,
  trimmed_mean_milliseconds, standard_deviation_milliseconds,
  interquartile_range_milliseconds, best_metres_per_second,
  median_metres_per_second, refreshed_at
) VALUES (
  '61000000-0000-4000-8000-000000000001', 'core-1', 'bike', 1000,
  '2026-08-24T23:00:00Z', 2, 10000, 10500, 10500, 10500, 500, 500,
  100, 95.238095, '2026-08-25T00:05:00Z'
);

INSERT INTO dna.discovery_exact_distance_benchmark (
  owner_id, mode, distance, data_current_through, race_entry_count,
  winning_entry_count, top_three_entry_count, winning_p25_milliseconds,
  winning_median_milliseconds, winning_p75_milliseconds,
  top_three_p25_milliseconds, top_three_median_milliseconds,
  top_three_p75_milliseconds, refreshed_at
) VALUES (
  '61000000-0000-4000-8000-000000000001', 'bike', 1000,
  '2026-08-24T23:00:00Z', 2, 1, 2, 10000, 10000, 10000,
  10250, 10500, 10750, '2026-08-25T00:05:00Z'
);

INSERT INTO dna.core_payout_format_profile (
  owner_id, source_core_id, mode, payout_format_key, payout_format_label,
  data_current_through, first_event_at, race_count, win_count,
  top_three_count, exact_distance_count, timed_race_count, refreshed_at
) VALUES (
  '61000000-0000-4000-8000-000000000001', 'core-1', 'bike',
  'top 3', 'Top 3', '2026-08-24T23:00:00Z', '2026-08-24T22:00:00Z',
  2, 1, 2, 1, 2, '2026-08-25T00:05:00Z'
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
  '61000000-0000-4000-8000-000000000001', 'core-1', 'bike', 1000,
  '2026-08-24T23:00:00Z', 2, 2, 0, 0, 0, 2, 2, 1, 1, 0, 0, 0,
  2, 1, 1, 0, 0, 1, '2026-08-25T00:05:00Z'
);

INSERT INTO dna.race_archive_aggregate_publication_receipt (
  owner_id, refresh_id, target_dataset_version_id, race_dataset_version_id,
  source_version_set_sha256, payload_sha256, core_performance_profile_count,
  validated_event_count, core_star_profile_count, discovery_benchmark_count,
  accepted_format_entry_count, payout_format_profile_count,
  materialized_row_count, refreshed_at, published_at
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000030',
  '61000000-0000-4000-8000-000000000020',
  '61000000-0000-4000-8000-000000000020',
  repeat('c',64), repeat('d',64), 1, 2, 1, 1, 2, 1, 6,
  '2026-08-25T00:05:00Z', '2026-08-25T00:05:00Z'
);

INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000031',
  '61000000-0000-4000-8000-000000000021',
  'archive-reuse-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '61000000-0000-4000-8000-000000000001'
  ),
  '2026-08-25T00:13:00Z', '2099-08-25T00:13:00Z'
);

DO $privileges$
BEGIN
  IF has_function_privilege(
    'dna_app_runtime',
    'dna.prepare_pro_league_aggregate_refresh_pre_archive_reuse(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime can bypass archive-preserving aggregate preparation';
  END IF;
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute archive-preserving aggregate preparation';
  END IF;
END
$privileges$;

DO $reuse$
DECLARE
  v_source_hash character(64);
  v_prepared record;
  v_race_job_status text;
  v_target_job_status text;
  v_target_count bigint;
BEGIN
  SELECT processing.source_version_set_sha256 INTO STRICT v_source_hash
  FROM dna.aggregate_refresh_processing processing
  WHERE processing.owner_id = '61000000-0000-4000-8000-000000000001'
    AND processing.refresh_id = '61000000-0000-4000-8000-000000000031';

  SELECT * INTO STRICT v_prepared
  FROM dna.prepare_pro_league_aggregate_refresh(
    '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000031',
    '61000000-0000-4000-8000-000000000021',
    v_source_hash
  );

  IF v_prepared.prepared_aggregate_set_id <>
       '61000000-0000-4000-8000-000000000031'::uuid
     OR v_prepared.aggregate_family_count <> 4
     OR v_prepared.materialized_row_count <> 6 THEN
    RAISE EXCEPTION 'rolling current-source aggregate reuse receipt is invalid';
  END IF;

  SELECT status INTO STRICT v_race_job_status
  FROM dna.aggregate_refresh_job
  WHERE owner_id = '61000000-0000-4000-8000-000000000001'
    AND id = '61000000-0000-4000-8000-000000000030';
  SELECT status, affected_record_count
  INTO STRICT v_target_job_status, v_target_count
  FROM dna.aggregate_refresh_job
  WHERE owner_id = '61000000-0000-4000-8000-000000000001'
    AND id = '61000000-0000-4000-8000-000000000031';

  IF v_race_job_status <> 'completed'
     OR v_target_job_status <> 'completed'
     OR v_target_count <> 6 THEN
    RAISE EXCEPTION 'rolling current-source refresh changed Race job state';
  END IF;

  IF (SELECT count(*) FROM dna.core_performance_profile
      WHERE owner_id = '61000000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(*) FROM dna.discovery_exact_distance_benchmark
      WHERE owner_id = '61000000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(*) FROM dna.core_payout_format_profile
      WHERE owner_id = '61000000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(*) FROM dna.core_star_profile
      WHERE owner_id = '61000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'rolling current-source refresh erased Race-derived analytics';
  END IF;
END
$reuse$;

UPDATE dna.core_star_profile
SET refreshed_at = '2026-08-25T00:06:00Z'
WHERE owner_id = '61000000-0000-4000-8000-000000000001';

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
) VALUES (
  '61000000-0000-4000-8000-000000000032',
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000021', 'queued'
);
INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000032',
  '61000000-0000-4000-8000-000000000021',
  'archive-reuse-worker-2', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '61000000-0000-4000-8000-000000000001'
  ),
  '2026-08-25T00:14:00Z', '2099-08-25T00:14:00Z'
);

DO $fail_closed$
DECLARE
  v_source_hash character(64);
BEGIN
  SELECT source_version_set_sha256 INTO STRICT v_source_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '61000000-0000-4000-8000-000000000001'
    AND refresh_id = '61000000-0000-4000-8000-000000000032';
  BEGIN
    PERFORM * FROM dna.prepare_pro_league_aggregate_refresh(
      '61000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000032',
      '61000000-0000-4000-8000-000000000021',
      v_source_hash
    );
    RAISE EXCEPTION 'drifted archive aggregate read models were reused';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'drifted archive aggregate read models were reused' THEN RAISE; END IF;
    IF position('do not match their publication receipt' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$fail_closed$;

ROLLBACK;
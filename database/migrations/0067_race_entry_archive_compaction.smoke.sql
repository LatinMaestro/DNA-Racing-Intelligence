BEGIN;

SET LOCAL app.owner_id = '67000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('67000000-0000-4000-8000-000000000001', 'race-entry-compaction-owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '67000000-0000-4000-8000-000000000010',
  '67000000-0000-4000-8000-000000000001',
  'race_merge', 'race.csv', repeat('a',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-26T00:00:00Z', '2026-08-26T00:01:00Z',
  '2026-08-25T22:00:00Z', '2026-08-25T23:00:00Z',
  '2026-08-25T23:00:00Z', 2, 2, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES (
  '67000000-0000-4000-8000-000000000020',
  '67000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '67000000-0000-4000-8000-000000000010',
  '2026-08-26T00:02:00Z', '2026-08-25T23:00:00Z',
  '2026-08-26T00:05:00Z', true
);

INSERT INTO dna.dataset_evidence_object (
  id, owner_id, import_batch_id, source_type, object_kind,
  partition_number, object_format, object_key, checksum_sha256,
  byte_size, row_count, first_natural_key, last_natural_key, created_at
) VALUES (
  '67000000-0000-4000-8000-000000000021',
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000010',
  'race_merge', 'staged_rows', 0, 'ndjson_gzip',
  'owners/67000000/race/part-0.ndjson.gz', repeat('b',64),
  256, 2, 'event-1:core-1', 'event-1:core-2',
  '2026-08-26T00:01:30Z'
);

INSERT INTO dna.dataset_version_evidence_receipt (
  owner_id, dataset_version_id, import_batch_id, source_type,
  evidence_kind, evidence_partition_count, evidence_row_count,
  evidence_byte_size, sealed_at
) VALUES (
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000020',
  '67000000-0000-4000-8000-000000000010',
  'race_merge', 'staged_rows', 1, 2, 256,
  '2026-08-26T00:05:00Z'
);

INSERT INTO dna.dataset_evidence_compaction_receipt (
  owner_id, import_batch_id, source_type, source_row_count,
  evidence_row_count, deleted_staged_record_count,
  deleted_contribution_count, compacted_at
) VALUES (
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000010',
  'race_merge', 2, 2, 2, 2, '2026-08-26T00:05:00Z'
);

INSERT INTO dna.race_row_evidence_compaction_receipt (
  owner_id, import_batch_id, dataset_version_id, source_row_count,
  evidence_kind, evidence_partition_count, evidence_byte_size,
  deleted_source_provenance_count, deleted_version_record_count,
  compacted_at
) VALUES (
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000010',
  '67000000-0000-4000-8000-000000000020',
  2, 'staged_rows', 1, 256, 0, 0, '2026-08-26T00:05:00Z'
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at, completed_at,
  affected_record_count
) VALUES (
  '67000000-0000-4000-8000-000000000030',
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000020',
  'completed', '2026-08-26T00:03:00Z', '2026-08-26T00:05:00Z', 4
);

INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
) VALUES (
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000030',
  '67000000-0000-4000-8000-000000000020',
  'race-entry-compaction-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '67000000-0000-4000-8000-000000000001'
  ),
  '2026-08-26T00:03:00Z', '2099-08-26T00:03:00Z'
);

INSERT INTO dna.core_performance_profile (
  owner_id, source_core_id, mode, distance, data_current_through, race_count,
  best_milliseconds, median_milliseconds, mean_milliseconds,
  trimmed_mean_milliseconds, standard_deviation_milliseconds,
  interquartile_range_milliseconds, best_metres_per_second,
  median_metres_per_second, refreshed_at
) VALUES (
  '67000000-0000-4000-8000-000000000001', 'core-1', 'bike', 1000,
  '2026-08-25T23:00:00Z', 2, 60000, 60500, 60500, 60500, 500, 500,
  16.666667, 16.528926, '2026-08-26T00:05:00Z'
);

INSERT INTO dna.discovery_exact_distance_benchmark (
  owner_id, mode, distance, data_current_through, race_entry_count,
  winning_entry_count, top_three_entry_count, winning_p25_milliseconds,
  winning_median_milliseconds, winning_p75_milliseconds,
  top_three_p25_milliseconds, top_three_median_milliseconds,
  top_three_p75_milliseconds, refreshed_at
) VALUES (
  '67000000-0000-4000-8000-000000000001', 'bike', 1000,
  '2026-08-25T23:00:00Z', 2, 1, 2, 60000, 60000, 60000,
  60250, 60500, 60750, '2026-08-26T00:05:00Z'
);

INSERT INTO dna.core_payout_format_profile (
  owner_id, source_core_id, mode, payout_format_key, payout_format_label,
  data_current_through, first_event_at, race_count, win_count,
  top_three_count, exact_distance_count, timed_race_count, refreshed_at
) VALUES (
  '67000000-0000-4000-8000-000000000001', 'core-1', 'bike',
  'top 3', 'Top 3', '2026-08-25T23:00:00Z', '2026-08-25T22:00:00Z',
  2, 1, 2, 1, 2, '2026-08-26T00:05:00Z'
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
  '67000000-0000-4000-8000-000000000001', 'core-1', 'bike', 1000,
  '2026-08-25T23:00:00Z', 2, 2, 0, 0, 0, 2, 2, 1, 1, 0, 0, 0,
  2, 1, 1, 0, 0, 1, '2026-08-26T00:05:00Z'
);

INSERT INTO dna.race_archive_aggregate_publication_receipt (
  owner_id, refresh_id, target_dataset_version_id, race_dataset_version_id,
  source_version_set_sha256, payload_sha256, core_performance_profile_count,
  validated_event_count, core_star_profile_count, discovery_benchmark_count,
  accepted_format_entry_count, payout_format_profile_count,
  materialized_row_count, refreshed_at, published_at
) VALUES (
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000030',
  '67000000-0000-4000-8000-000000000020',
  '67000000-0000-4000-8000-000000000020',
  dna.active_pro_league_source_version_set_sha256(
    '67000000-0000-4000-8000-000000000001'
  ),
  repeat('c',64), 1, 0, 1, 1, 2, 1, 4,
  '2026-08-26T00:05:00Z', '2026-08-26T00:05:00Z'
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
) VALUES (
  '67000000-0000-4000-8000-000000000040',
  '67000000-0000-4000-8000-000000000001',
  'event-1', '2026-08-25T22:00:00Z', 'bike', 1000, 8,
  '67000000-0000-4000-8000-000000000010', true
);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, elapsed_time_milliseconds,
  speed_microunits, finish_position, economic_data_status,
  source_import_batch_id, active_in_dataset, source_fingerprint_sha256,
  payout_format_label
) VALUES
(
  '67000000-0000-4000-8000-000000000041',
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000040',
  'core-1', 8, true, false, 'complete', 60000, 16666667, 1, 'absent',
  '67000000-0000-4000-8000-000000000010', true,
  decode(repeat('d',64), 'hex'), 'Top 3'
),
(
  '67000000-0000-4000-8000-000000000042',
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000040',
  'core-2', 8, false, true, 'complete', 61000, 16393443, 2, 'absent',
  '67000000-0000-4000-8000-000000000010', true,
  decode(repeat('e',64), 'hex'), 'Top 3'
);

DO $missing_locator_fails_closed$
BEGIN
  BEGIN
    PERFORM * FROM dna.compact_published_race_entries(
      '67000000-0000-4000-8000-000000000001',
      '67000000-0000-4000-8000-000000000030',
      '2026-08-26T00:06:00Z'
    );
    RAISE EXCEPTION 'Race entry compaction ignored missing Core locators';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Race entry compaction ignored missing Core locators' THEN
      RAISE;
    END IF;
    IF position(
      'complete sealed Race archive compaction prerequisites are unavailable'
      in SQLERRM
    ) = 0 THEN
      RAISE;
    END IF;
  END;
END
$missing_locator_fails_closed$;

INSERT INTO dna.race_archive_core_locator_receipt (
  owner_id, dataset_version_id, import_batch_id, locator_set_sha256,
  core_locator_count, ready_row_count, partition_reference_count, built_at
) VALUES (
  '67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000020',
  '67000000-0000-4000-8000-000000000010',
  repeat('f',64), 2, 2, 2, '2026-08-26T00:04:30Z'
);

DO $publish_and_compact$
DECLARE
  v_source_hash character(64);
  v_result record;
  v_receipt dna.race_entry_archive_compaction_receipt%ROWTYPE;
BEGIN
  v_source_hash := dna.active_pro_league_source_version_set_sha256(
    '67000000-0000-4000-8000-000000000001'
  );

  SELECT * INTO STRICT v_result
  FROM dna.publish_pro_league_aggregate_refresh(
    '67000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000030',
    '67000000-0000-4000-8000-000000000020',
    'race-entry-compaction-worker',
    '67000000-0000-4000-8000-000000000030',
    v_source_hash,
    4,
    4,
    '2026-08-26T00:06:00Z'
  );

  IF v_result.status <> 'published'
     OR v_result.aggregate_set_id <>
       '67000000-0000-4000-8000-000000000030'::uuid THEN
    RAISE EXCEPTION 'Race aggregate publication did not complete';
  END IF;

  SELECT receipt.* INTO STRICT v_receipt
  FROM dna.race_entry_archive_compaction_receipt receipt
  WHERE receipt.owner_id = '67000000-0000-4000-8000-000000000001'
    AND receipt.refresh_id = '67000000-0000-4000-8000-000000000030';

  IF v_receipt.deleted_entry_count <> 2
     OR v_receipt.preserved_event_count <> 1 THEN
    RAISE EXCEPTION 'Race entry archive compaction receipt is invalid';
  END IF;

  IF (SELECT count(*) FROM dna.race_entry
      WHERE owner_id = '67000000-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'Race entry detail remains after archive compaction';
  END IF;
  IF (SELECT count(*) FROM dna.race_event
      WHERE owner_id = '67000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'Race event identity was removed by entry compaction';
  END IF;
  IF (SELECT state FROM dna.aggregate_refresh_processing
      WHERE owner_id = '67000000-0000-4000-8000-000000000001'
        AND refresh_id = '67000000-0000-4000-8000-000000000030')
       <> 'published' THEN
    RAISE EXCEPTION 'aggregate publication state did not remain published';
  END IF;
END
$publish_and_compact$;

DO $compaction_replay$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.compact_published_race_entries(
    '67000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000030',
    '2026-08-26T00:07:00Z'
  );

  IF v_result.status <> 'existing'
     OR v_result.deleted_entry_count <> 2
     OR v_result.preserved_event_count <> 1 THEN
    RAISE EXCEPTION 'Race entry archive compaction replay is invalid';
  END IF;
END
$compaction_replay$;

ROLLBACK;

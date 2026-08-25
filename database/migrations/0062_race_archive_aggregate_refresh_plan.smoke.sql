BEGIN;

SET LOCAL app.owner_id = '62000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('62000000-0000-4000-8000-000000000001', 'race-archive-plan-owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
(
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000001',
  'race_merge', 'race-1.csv', repeat('a',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-25T11:00:00Z', '2026-08-25T11:01:00Z',
  '2026-08-20T00:00:00Z', '2026-08-20T23:00:00Z',
  '2026-08-20T23:00:00Z', 1, 1, 0, 0
),
(
  '62000000-0000-4000-8000-000000000011',
  '62000000-0000-4000-8000-000000000001',
  'race_merge', 'race-2.csv', repeat('b',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-25T12:00:00Z', '2026-08-25T12:01:00Z',
  '2026-08-21T00:00:00Z', '2026-08-21T23:00:00Z',
  '2026-08-21T23:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_evidence_object (
  id, owner_id, import_batch_id, source_type, object_kind,
  partition_number, object_format, object_key, checksum_sha256,
  byte_size, row_count, first_natural_key, last_natural_key, created_at
) VALUES
(
  '62000000-0000-4000-8000-000000000040',
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000010', 'race_merge', 'staged_rows',
  0, 'ndjson_gzip', 'synthetic/race-1/part-0.ndjson.gz', repeat('1',64),
  100, 1, NULL, NULL, '2026-08-25T11:05:30Z'
),
(
  '62000000-0000-4000-8000-000000000041',
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000011', 'race_merge', 'staged_rows',
  0, 'ndjson_gzip', 'synthetic/race-2/part-0.ndjson.gz', repeat('2',64),
  100, 1, NULL, NULL, '2026-08-25T12:03:30Z'
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES
(
  '62000000-0000-4000-8000-000000000020',
  '62000000-0000-4000-8000-000000000001', 'race_merge', 1,
  '62000000-0000-4000-8000-000000000010',
  '2026-08-25T11:02:00Z', '2026-08-20T23:00:00Z',
  '2026-08-25T11:05:00Z', false
),
(
  '62000000-0000-4000-8000-000000000021',
  '62000000-0000-4000-8000-000000000001', 'race_merge', 2,
  '62000000-0000-4000-8000-000000000011',
  '2026-08-25T12:02:00Z', '2026-08-21T23:00:00Z', NULL, true
);

INSERT INTO dna.dataset_version_evidence_receipt (
  owner_id, dataset_version_id, import_batch_id, source_type, evidence_kind,
  evidence_partition_count, evidence_row_count, evidence_byte_size, sealed_at
) VALUES
(
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000020',
  '62000000-0000-4000-8000-000000000010', 'race_merge', 'staged_rows',
  1, 1, 100, '2026-08-25T11:06:00Z'
),
(
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000021',
  '62000000-0000-4000-8000-000000000011', 'race_merge', 'staged_rows',
  1, 1, 100, '2026-08-25T12:04:00Z'
);

INSERT INTO dna.race_archive_core_locator_receipt (
  owner_id, dataset_version_id, import_batch_id, locator_set_sha256,
  core_locator_count, ready_row_count, partition_reference_count, built_at
) VALUES
(
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000020',
  '62000000-0000-4000-8000-000000000010', repeat('c',64),
  1, 1, 1, '2026-08-25T11:07:00Z'
),
(
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000021',
  '62000000-0000-4000-8000-000000000011', repeat('d',64),
  1, 1, 1, '2026-08-25T12:04:30Z'
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
) VALUES (
  '62000000-0000-4000-8000-000000000030',
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000021', 'queued'
);

INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
) VALUES (
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000030',
  '62000000-0000-4000-8000-000000000021',
  'race-archive-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '62000000-0000-4000-8000-000000000001'
  ),
  '2026-08-25T12:03:00Z', '2099-08-25T12:03:00Z'
);

INSERT INTO dna.core_performance_profile (
  owner_id, source_core_id, mode, distance, data_current_through, race_count,
  best_milliseconds, median_milliseconds, mean_milliseconds,
  trimmed_mean_milliseconds, standard_deviation_milliseconds,
  interquartile_range_milliseconds, best_metres_per_second,
  median_metres_per_second, refreshed_at
) VALUES (
  '62000000-0000-4000-8000-000000000001', 'core-1', 'bike', 1000,
  '2026-08-21T23:00:00Z', 1, 10000, 10000, 10000, 10000, 0, 0,
  100, 100, '2026-08-25T12:05:00Z'
);

INSERT INTO dna.race_archive_aggregate_publication_receipt (
  owner_id, refresh_id, target_dataset_version_id, race_dataset_version_id,
  source_version_set_sha256, payload_sha256, core_performance_profile_count,
  validated_event_count, core_star_profile_count, discovery_benchmark_count,
  accepted_format_entry_count, payout_format_profile_count,
  materialized_row_count, refreshed_at, published_at
) VALUES (
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000030',
  '62000000-0000-4000-8000-000000000021',
  '62000000-0000-4000-8000-000000000021',
  dna.active_pro_league_source_version_set_sha256(
    '62000000-0000-4000-8000-000000000001'
  ),
  repeat('e',64), 1, 0, 0, 0, 0, 0, 1,
  '2026-08-25T12:05:00Z', '2026-08-25T12:05:30Z'
);

DO $plan$
DECLARE
  v_hash character(64);
  v_versions bigint[];
BEGIN
  IF has_function_privilege(
    'dna_app_runtime',
    'dna.prepare_pro_league_aggregate_refresh_pre_race_archive_switch(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime can bypass Race archive aggregate finalisation';
  END IF;

  SELECT source_version_set_sha256 INTO STRICT v_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '62000000-0000-4000-8000-000000000001'
    AND refresh_id = '62000000-0000-4000-8000-000000000030';

  SELECT array_agg(plan.version_number ORDER BY plan.version_number)
  INTO STRICT v_versions
  FROM dna.list_race_archive_aggregate_refresh_versions(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000030',
    '62000000-0000-4000-8000-000000000021', v_hash, 10
  ) plan;

  IF v_versions <> ARRAY[1,2]::bigint[] THEN
    RAISE EXCEPTION 'Race archive aggregate refresh plan is not exact and ordered';
  END IF;

  BEGIN
    PERFORM * FROM dna.list_race_archive_aggregate_refresh_versions(
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000030',
      '62000000-0000-4000-8000-000000000021', v_hash, 1
    );
    RAISE EXCEPTION 'Race archive aggregate version bound was not enforced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Race archive aggregate version bound was not enforced' THEN RAISE; END IF;
    IF position('version count exceeds its bound' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM dna.dataset_version_evidence_receipt
    WHERE owner_id = '62000000-0000-4000-8000-000000000001'
      AND dataset_version_id = '62000000-0000-4000-8000-000000000020';
    PERFORM * FROM dna.list_race_archive_aggregate_refresh_versions(
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000030',
      '62000000-0000-4000-8000-000000000021', v_hash, 10
    );
    RAISE EXCEPTION 'incomplete Race archive evidence was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete Race archive evidence was accepted' THEN RAISE; END IF;
    IF position('complete sealed Race archive aggregate evidence is unavailable' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$plan$;

DO $finalise$
DECLARE
  v_hash character(64);
  v_compaction record;
  v_prepared record;
  v_publish record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM dna.race_entry entry
    WHERE entry.owner_id = '62000000-0000-4000-8000-000000000001'
  ) OR EXISTS (
    SELECT 1 FROM dna.race_event event
    WHERE event.owner_id = '62000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'archive refresh fixture unexpectedly has detailed Race rows';
  END IF;

  SELECT * INTO STRICT v_compaction
  FROM dna.compact_accepted_dataset_evidence(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000011',
    '2026-08-25T12:05:45Z'
  );
  IF v_compaction.status NOT IN ('compacted', 'existing') THEN
    RAISE EXCEPTION 'current Race activation evidence was not compacted';
  END IF;

  SELECT source_version_set_sha256 INTO STRICT v_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '62000000-0000-4000-8000-000000000001'
    AND refresh_id = '62000000-0000-4000-8000-000000000030';

  SELECT * INTO STRICT v_prepared
  FROM dna.prepare_pro_league_aggregate_refresh(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000030',
    '62000000-0000-4000-8000-000000000021', v_hash
  );

  IF v_prepared.prepared_aggregate_set_id <>
       '62000000-0000-4000-8000-000000000030'::uuid
     OR v_prepared.aggregate_family_count <> 4
     OR v_prepared.materialized_row_count <> 1
     OR (SELECT status FROM dna.aggregate_refresh_job
         WHERE owner_id = '62000000-0000-4000-8000-000000000001'
           AND id = '62000000-0000-4000-8000-000000000030') <> 'completed'
     OR (SELECT aggregate_refreshed_at FROM dna.dataset_version
         WHERE owner_id = '62000000-0000-4000-8000-000000000001'
           AND id = '62000000-0000-4000-8000-000000000021') <>
        '2026-08-25T12:05:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Race archive aggregate finalisation did not complete the target';
  END IF;

  SELECT * INTO STRICT v_publish
  FROM dna.publish_pro_league_aggregate_refresh(
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000030',
    '62000000-0000-4000-8000-000000000021', 'race-archive-worker',
    '62000000-0000-4000-8000-000000000030', v_hash, 4, 1,
    '2026-08-25T12:06:00Z'
  );

  IF v_publish.status <> 'published'
     OR (SELECT state FROM dna.aggregate_refresh_processing
         WHERE owner_id = '62000000-0000-4000-8000-000000000001'
           AND refresh_id = '62000000-0000-4000-8000-000000000030') <> 'published'
     OR NOT EXISTS (
       SELECT 1 FROM dna.race_row_evidence_compaction_receipt receipt
       WHERE receipt.owner_id = '62000000-0000-4000-8000-000000000001'
         AND receipt.import_batch_id = '62000000-0000-4000-8000-000000000011'
     ) THEN
    RAISE EXCEPTION 'archive-backed Race publication did not complete safely';
  END IF;
END
$finalise$;

INSERT INTO dna.aggregate_refresh_job (id, owner_id, dataset_version_id, status)
VALUES (
  '62000000-0000-4000-8000-000000000031',
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000021', 'queued'
);
INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
) VALUES (
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000031',
  '62000000-0000-4000-8000-000000000021', 'race-archive-worker-2',
  'processing', dna.active_pro_league_source_version_set_sha256(
    '62000000-0000-4000-8000-000000000001'
  ), '2026-08-25T12:07:00Z', '2099-08-25T12:07:00Z'
);

DO $no_fallback$
DECLARE
  v_hash character(64);
BEGIN
  SELECT source_version_set_sha256 INTO STRICT v_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '62000000-0000-4000-8000-000000000001'
    AND refresh_id = '62000000-0000-4000-8000-000000000031';
  BEGIN
    PERFORM * FROM dna.prepare_pro_league_aggregate_refresh(
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000031',
      '62000000-0000-4000-8000-000000000021', v_hash
    );
    RAISE EXCEPTION 'commissioned Race archive refresh fell back to detailed rows';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'commissioned Race archive refresh fell back to detailed rows' THEN RAISE; END IF;
    IF position('current Race archive aggregate publication is required' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$no_fallback$;

ROLLBACK;

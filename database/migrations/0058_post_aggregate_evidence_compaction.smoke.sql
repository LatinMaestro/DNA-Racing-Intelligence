BEGIN;

SET LOCAL app.owner_id = '58000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '58000000-0000-4000-8000-000000000001',
  'synthetic_post_aggregate_compaction_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '58000000-0000-4000-8000-000000000101',
  '58000000-0000-4000-8000-000000000001',
  'race_merge', 'post-aggregate-race.csv', repeat('1', 64),
  'utf_8', 'race-merge/v1', 'accepted',
  '2026-08-24T20:00:00Z', '2026-08-24T20:01:00Z',
  '2026-08-24T19:00:00Z', '2026-08-24T19:00:00Z',
  '2026-08-24T19:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES (
  '58000000-0000-4000-8000-000000000201',
  '58000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '58000000-0000-4000-8000-000000000101',
  '2026-08-24T20:02:00Z', '2026-08-24T19:00:00Z',
  '2026-08-24T20:03:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at, completed_at,
  affected_record_count
) VALUES (
  '58000000-0000-4000-8000-000000000211',
  '58000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000201',
  'completed', '2026-08-24T20:03:00Z', '2026-08-24T20:03:00Z', 1
);

INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
)
SELECT
  '58000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000211',
  '58000000-0000-4000-8000-000000000201',
  'synthetic-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '58000000-0000-4000-8000-000000000001'
  ),
  '2026-08-24T20:03:00Z', '2026-08-24T20:33:00Z';

INSERT INTO dna.dataset_evidence_object (
  id, owner_id, import_batch_id, source_type, object_kind,
  partition_number, object_format, object_key, checksum_sha256,
  byte_size, row_count, first_natural_key, last_natural_key, created_at
) VALUES (
  '58000000-0000-4000-8000-000000000221',
  '58000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000101',
  'race_merge', 'staged_rows', 0, 'ndjson_gzip',
  'private/synthetic/post-aggregate-race.ndjson.gz', repeat('2', 64),
  512, 1, 'post-event:post-core', 'post-event:post-core',
  '2026-08-24T20:00:30Z'
);

INSERT INTO dna.dataset_evidence_compaction_receipt (
  owner_id, import_batch_id, source_type, source_row_count,
  evidence_row_count, deleted_staged_record_count,
  deleted_contribution_count, compacted_at
) VALUES (
  '58000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000101',
  'race_merge', 1, 1, 1, 1, '2026-08-24T20:02:30Z'
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
) VALUES (
  '58000000-0000-4000-8000-000000000301',
  '58000000-0000-4000-8000-000000000001',
  'post-event', '2026-08-24T19:00:00Z', 'bike', 1000, 4,
  '58000000-0000-4000-8000-000000000101', true
);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, elapsed_time_milliseconds,
  speed_microunits, finish_position, economic_data_status,
  source_import_batch_id, active_in_dataset, source_fingerprint_sha256,
  payout_format_label
) VALUES (
  '58000000-0000-4000-8000-000000000401',
  '58000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000301',
  'post-core', 4, true, false, 'complete', 50000, 20000000, 1,
  'validated', '58000000-0000-4000-8000-000000000101', true,
  decode(repeat('a', 64), 'hex'), 'winner-takes-all'
);

INSERT INTO dna.race_entry_source (
  id, owner_id, race_entry_id, import_batch_id, source_row_number,
  source_row_checksum, raw_gold_star, raw_blue_star, raw_payout,
  is_selected_fact, raw_elapsed_time
) VALUES (
  '58000000-0000-4000-8000-000000000501',
  '58000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000401',
  '58000000-0000-4000-8000-000000000101', 1,
  repeat('a', 64), 'TRUE', 'FALSE', 'winner-takes-all', true, '50.000'
);

DO $publish_with_compaction$
DECLARE
  v_source_hash character(64);
  v_result record;
BEGIN
  v_source_hash := dna.active_pro_league_source_version_set_sha256(
    '58000000-0000-4000-8000-000000000001'
  );

  SELECT * INTO STRICT v_result
  FROM dna.publish_pro_league_aggregate_refresh(
    '58000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000211',
    '58000000-0000-4000-8000-000000000201',
    'synthetic-worker',
    '58000000-0000-4000-8000-000000000211',
    v_source_hash,
    4,
    1,
    '2026-08-24T20:04:00Z'
  );

  IF v_result.status <> 'published'
     OR v_result.aggregate_set_id <>
       '58000000-0000-4000-8000-000000000211'::uuid THEN
    RAISE EXCEPTION 'aggregate publication did not complete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = '58000000-0000-4000-8000-000000000001'
      AND processing.refresh_id = '58000000-0000-4000-8000-000000000211'
      AND processing.state = 'published'
  ) THEN
    RAISE EXCEPTION 'aggregate publication state was not persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = '58000000-0000-4000-8000-000000000001'
      AND receipt.dataset_version_id = '58000000-0000-4000-8000-000000000201'
      AND receipt.import_batch_id = '58000000-0000-4000-8000-000000000101'
      AND receipt.evidence_kind = 'staged_rows'
      AND receipt.evidence_row_count = 1
      AND receipt.evidence_byte_size = 512
  ) THEN
    RAISE EXCEPTION 'dataset version evidence receipt was not sealed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_row_evidence_compaction_receipt receipt
    WHERE receipt.owner_id = '58000000-0000-4000-8000-000000000001'
      AND receipt.import_batch_id = '58000000-0000-4000-8000-000000000101'
      AND receipt.deleted_source_provenance_count = 1
  ) THEN
    RAISE EXCEPTION 'Race Merge row compaction receipt was not retained';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.race_entry_source source
    WHERE source.owner_id = '58000000-0000-4000-8000-000000000001'
      AND source.import_batch_id = '58000000-0000-4000-8000-000000000101'
  ) THEN
    RAISE EXCEPTION 'Race Merge source provenance survived aggregate publication';
  END IF;
END
$publish_with_compaction$;

ROLLBACK;

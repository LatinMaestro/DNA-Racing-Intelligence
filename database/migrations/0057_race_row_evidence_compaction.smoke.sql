BEGIN;

SET LOCAL app.owner_id = '57000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '57000000-0000-4000-8000-000000000001',
  'synthetic_race_row_compaction_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '57000000-0000-4000-8000-000000000101',
  '57000000-0000-4000-8000-000000000001',
  'race_merge', 'compacted-race-v1.csv', repeat('1', 64),
  'utf_8', 'race-merge/v1', 'accepted',
  '2026-08-24T18:00:00Z', '2026-08-24T18:01:00Z',
  '2026-08-24T17:00:00Z', '2026-08-24T17:00:00Z',
  '2026-08-24T17:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES (
  '57000000-0000-4000-8000-000000000201',
  '57000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '57000000-0000-4000-8000-000000000101',
  '2026-08-24T18:02:00Z', '2026-08-24T17:00:00Z',
  '2026-08-24T18:03:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at, completed_at,
  affected_record_count
) VALUES (
  '57000000-0000-4000-8000-000000000211',
  '57000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000201',
  'completed', '2026-08-24T18:03:00Z', '2026-08-24T18:03:00Z', 1
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
) VALUES (
  '57000000-0000-4000-8000-000000000301',
  '57000000-0000-4000-8000-000000000001',
  'compacted-event', '2026-08-24T17:00:00Z',
  'bike', 1000, 4,
  '57000000-0000-4000-8000-000000000101', true
);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, elapsed_time_milliseconds,
  speed_microunits, finish_position, economic_data_status,
  source_import_batch_id, active_in_dataset, source_fingerprint_sha256,
  payout_format_label
) VALUES (
  '57000000-0000-4000-8000-000000000401',
  '57000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000301',
  'compacted-core', 4, true, false, 'complete', 50000, 20000000, 1,
  'validated', '57000000-0000-4000-8000-000000000101', true,
  decode(repeat('a', 64), 'hex'), 'winner-takes-all'
);

INSERT INTO dna.race_entry_source (
  id, owner_id, race_entry_id, import_batch_id, source_row_number,
  source_row_checksum, raw_gold_star, raw_blue_star, raw_payout,
  is_selected_fact, raw_elapsed_time
) VALUES (
  '57000000-0000-4000-8000-000000000501',
  '57000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000401',
  '57000000-0000-4000-8000-000000000101', 1,
  repeat('a', 64), 'TRUE', 'FALSE', 'winner-takes-all', true, '50.000'
);

ALTER TABLE dna.dataset_version_record
  DISABLE TRIGGER suppress_race_merge_version_record;
INSERT INTO dna.dataset_version_record (
  owner_id, dataset_version_id, source_type, natural_key,
  fingerprint_sha256, first_accepted_batch_id
) VALUES (
  '57000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000201',
  'race_merge', 'compacted-event:compacted-core', repeat('a', 64),
  '57000000-0000-4000-8000-000000000101'
);
ALTER TABLE dna.dataset_version_record
  ENABLE TRIGGER suppress_race_merge_version_record;

INSERT INTO dna.dataset_version_evidence_receipt (
  owner_id, dataset_version_id, import_batch_id, source_type,
  evidence_kind, evidence_partition_count, evidence_row_count,
  evidence_byte_size, sealed_at
) VALUES (
  '57000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000201',
  '57000000-0000-4000-8000-000000000101',
  'race_merge', 'staged_rows', 1, 1, 512,
  '2026-08-24T18:04:00Z'
);

INSERT INTO dna.dataset_evidence_compaction_receipt (
  owner_id, import_batch_id, source_type, source_row_count,
  evidence_row_count, deleted_staged_record_count,
  deleted_contribution_count, compacted_at
) VALUES (
  '57000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000101',
  'race_merge', 1, 1, 1, 1, '2026-08-24T18:04:30Z'
);

DO $compact_row_evidence$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.compact_race_row_evidence(
    '57000000-0000-4000-8000-000000000001',
    '57000000-0000-4000-8000-000000000101',
    '2026-08-24T18:05:00Z'
  );

  IF v_result.status <> 'compacted'
     OR v_result.deleted_source_provenance_count <> 1
     OR v_result.deleted_version_record_count <> 1 THEN
    RAISE EXCEPTION 'Race Merge row evidence compaction counts are incorrect';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.race_entry_source
    WHERE owner_id = '57000000-0000-4000-8000-000000000001'
      AND import_batch_id = '57000000-0000-4000-8000-000000000101'
  ) OR EXISTS (
    SELECT 1 FROM dna.dataset_version_record
    WHERE owner_id = '57000000-0000-4000-8000-000000000001'
      AND source_type = 'race_merge'
  ) THEN
    RAISE EXCEPTION 'per-row Neon evidence survived guarded compaction';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_row_evidence_compaction_receipt receipt
    WHERE receipt.owner_id = '57000000-0000-4000-8000-000000000001'
      AND receipt.import_batch_id = '57000000-0000-4000-8000-000000000101'
      AND receipt.evidence_kind = 'staged_rows'
      AND receipt.evidence_partition_count = 1
      AND receipt.evidence_byte_size = 512
  ) THEN
    RAISE EXCEPTION 'bounded Race Merge compaction receipt was not retained';
  END IF;
END
$compact_row_evidence$;

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  minimum_accepted_event_at, maximum_accepted_event_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
  (
    '57000000-0000-4000-8000-000000000102',
    '57000000-0000-4000-8000-000000000001',
    'race_merge', 'compacted-replay.csv', repeat('2', 64),
    'utf_8', 'race-merge/v1', 'validating',
    '2026-08-24T19:00:00Z', '2026-08-24T17:00:00Z',
    '2026-08-24T17:00:00Z', 1, 0, 1, 0
  ),
  (
    '57000000-0000-4000-8000-000000000103',
    '57000000-0000-4000-8000-000000000001',
    'race_merge', 'compacted-conflict.csv', repeat('3', 64),
    'utf_8', 'race-merge/v1', 'validating',
    '2026-08-24T20:00:00Z', '2026-08-24T17:00:00Z',
    '2026-08-24T17:00:00Z', 1, 0, 1, 0
  );

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number, natural_key,
  fingerprint_sha256, status, issue_codes
) VALUES
  (
    '57000000-0000-4000-8000-000000000001',
    '57000000-0000-4000-8000-000000000102',
    1, 'compacted-event:compacted-core', repeat('a', 64), 'ready', '{}'
  ),
  (
    '57000000-0000-4000-8000-000000000001',
    '57000000-0000-4000-8000-000000000103',
    1, 'compacted-event:compacted-core', repeat('b', 64), 'ready', '{}'
  );

INSERT INTO dna.normalized_race_staged_fact (
  owner_id, import_batch_id, source_row_number, source_event_id, event_at,
  mode, distance, source_core_id, gate_count, gold_star, blue_star,
  raw_gold_star, raw_blue_star, star_data_status, finish_position,
  elapsed_time_source_value
) VALUES
  (
    '57000000-0000-4000-8000-000000000001',
    '57000000-0000-4000-8000-000000000102', 1,
    'compacted-event', '2026-08-24T17:00:00Z', 'bike', 1000,
    'compacted-core', 4, true, false, 'TRUE', 'FALSE', 'complete', 1,
    '50.000'
  ),
  (
    '57000000-0000-4000-8000-000000000001',
    '57000000-0000-4000-8000-000000000103', 1,
    'compacted-event', '2026-08-24T17:00:00Z', 'bike', 1000,
    'compacted-core', 4, true, false, 'TRUE', 'FALSE', 'complete', 1,
    '50.000'
  );

DO $replay_after_compaction$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.accept_staged_race_dataset(
    '57000000-0000-4000-8000-000000000102',
    '57000000-0000-4000-8000-000000000202',
    '2026-08-24T19:01:00Z', '2026-08-24T19:02:00Z',
    '2026-08-24T17:00:00Z'
  );

  IF v_result.result_status <> 'accepted' THEN
    RAISE EXCEPTION 'exact Race Merge replay was not accepted after compaction';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.dataset_version_record
    WHERE owner_id = '57000000-0000-4000-8000-000000000001'
      AND source_type = 'race_merge'
  ) THEN
    RAISE EXCEPTION 'Race Merge replay recreated the per-key version ledger';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.race_entry entry
    WHERE entry.owner_id = '57000000-0000-4000-8000-000000000001'
      AND entry.source_core_id = 'compacted-core'
      AND encode(entry.source_fingerprint_sha256, 'hex') = repeat('a', 64)
      AND entry.source_import_batch_id =
        '57000000-0000-4000-8000-000000000101'
  ) THEN
    RAISE EXCEPTION 'compact Race Merge replay changed durable identity';
  END IF;
END
$replay_after_compaction$;

DO $conflict_after_compaction$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.accept_staged_race_dataset(
    '57000000-0000-4000-8000-000000000103',
    '57000000-0000-4000-8000-000000000203',
    '2026-08-24T20:01:00Z', '2026-08-24T20:02:00Z',
    '2026-08-24T17:00:00Z'
  );

  IF v_result.result_status <> 'quarantined' THEN
    RAISE EXCEPTION 'mutated Race Merge replay was not quarantined';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.dataset_staged_record staged
    WHERE staged.owner_id = '57000000-0000-4000-8000-000000000001'
      AND staged.import_batch_id = '57000000-0000-4000-8000-000000000103'
      AND staged.status = 'quarantined'
      AND staged.issue_codes @> ARRAY['FINGERPRINT_CONFLICT']
  ) THEN
    RAISE EXCEPTION 'compact replay conflict evidence is missing';
  END IF;
END
$conflict_after_compaction$;

ROLLBACK;

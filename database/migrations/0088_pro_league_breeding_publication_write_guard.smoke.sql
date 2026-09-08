BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('88000000-0000-4000-8000-000000000001', 'synthetic_breeding_write_guard_owner'),
  ('88000000-0000-4000-8000-000000000002', 'synthetic_breeding_write_guard_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
) VALUES
  (
    '88000000-0000-4000-8000-000000000101',
    '88000000-0000-4000-8000-000000000001',
    'race_merge', 'synthetic-write-guard-races.json', repeat('7', 64),
    'utf_8', 'dna-open-lab/v1', 'accepted', '2026-09-08T00:00:00Z',
    '2026-09-08T00:30:00Z', '2026-09-08T00:10:00Z',
    '2026-09-08T00:10:00Z', '2026-09-08T00:10:00Z', 1, 1, 0, 0
  ),
  (
    '88000000-0000-4000-8000-000000000102',
    '88000000-0000-4000-8000-000000000001',
    'current_arena', 'synthetic-write-guard-arena.json', repeat('8', 64),
    'utf_8', 'dna-open-lab/v1', 'accepted', '2026-09-08T00:05:00Z',
    '2026-09-08T00:20:00Z', NULL, NULL, '2026-09-08T00:05:00Z',
    1, 1, 0, 0
  );

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES
  (
    '88000000-0000-4000-8000-000000000201',
    '88000000-0000-4000-8000-000000000001',
    'race_merge', 1, '88000000-0000-4000-8000-000000000101',
    '2026-09-08T00:31:00Z', '2026-09-08T00:10:00Z',
    '2026-09-08T00:32:00Z', true
  ),
  (
    '88000000-0000-4000-8000-000000000202',
    '88000000-0000-4000-8000-000000000001',
    'current_arena', 1, '88000000-0000-4000-8000-000000000102',
    '2026-09-08T00:21:00Z', '2026-09-08T00:05:00Z',
    '2026-09-08T00:22:00Z', true
  );

INSERT INTO dna.pro_league_evidence_generation (
  owner_id, generation_id, race_dataset_version_id, worker_id,
  source_version_set_sha256, evidence_cutoff_at, input_observation_count,
  accepted_entry_count, non_bike_entry_count, missing_format_entry_count,
  unsupported_format_entry_count, unpublished_cell_entry_count,
  unbenchmarked_entry_count, benchmark_count, profile_count,
  payload_sha256, state, published_at
) VALUES (
  '88000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000301',
  '88000000-0000-4000-8000-000000000201',
  'synthetic-write-guard-worker', repeat('9', 64),
  '2026-09-08T01:00:00Z', 1, 1, 0, 0, 0, 0, 0, 1, 1,
  repeat('a', 64), 'published', '2026-09-08T01:01:00Z'
);
INSERT INTO dna.pro_league_evidence_active (
  owner_id, generation_id, activated_at
) VALUES (
  '88000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000301',
  '2026-09-08T01:01:00Z'
);

DO $privileges$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.dataset_stream', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.pro_league_evidence_active', 'SELECT')
     OR NOT has_function_privilege('dna_app_runtime',
       'dna.assert_current_pro_league_breeding_publication_authority(uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'Pro League breeding publication write guard privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '88000000-0000-4000-8000-000000000001';
SELECT dna.assert_current_pro_league_breeding_publication_authority(
  '88000000-0000-4000-8000-000000000001',
  '2026-09-08T01:00:00Z', '2026-09-08T00:30:00Z',
  '2026-09-08T00:20:00Z'
);

DO $stream_locks$
BEGIN
  IF (SELECT count(*) FROM dna.dataset_stream
      WHERE owner_id = '88000000-0000-4000-8000-000000000001'
        AND source_type IN ('current_arena', 'race_merge')) <> 2 THEN
    RAISE EXCEPTION 'publication authority streams were not locked safely';
  END IF;
END
$stream_locks$;

DO $changed_authority$
BEGIN
  BEGIN
    PERFORM dna.assert_current_pro_league_breeding_publication_authority(
      '88000000-0000-4000-8000-000000000001',
      '2026-09-08T01:00:00Z', '2026-09-08T00:29:00Z',
      '2026-09-08T00:20:00Z'
    );
    RAISE EXCEPTION 'changed performance authority was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'changed performance authority was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'current Pro League breeding publication authority changed' THEN RAISE; END IF;
  END;

  UPDATE dna.dataset_version
  SET aggregate_refreshed_at = NULL
  WHERE owner_id = '88000000-0000-4000-8000-000000000001'
    AND source_type = 'current_arena' AND is_active;
  BEGIN
    PERFORM dna.assert_current_pro_league_breeding_publication_authority(
      '88000000-0000-4000-8000-000000000001',
      '2026-09-08T01:00:00Z', '2026-09-08T00:30:00Z',
      '2026-09-08T00:20:00Z'
    );
    RAISE EXCEPTION 'incomplete Arena authority was accepted at write boundary';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete Arena authority was accepted at write boundary' THEN RAISE; END IF;
    IF SQLERRM <> 'current Pro League breeding publication authority changed' THEN RAISE; END IF;
  END;
END
$changed_authority$;

SET LOCAL app.owner_id = '88000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM dna.assert_current_pro_league_breeding_publication_authority(
      '88000000-0000-4000-8000-000000000001',
      '2026-09-08T01:00:00Z', '2026-09-08T00:30:00Z',
      '2026-09-08T00:20:00Z'
    );
    RAISE EXCEPTION 'cross-owner publication authority was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner publication authority was accepted' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

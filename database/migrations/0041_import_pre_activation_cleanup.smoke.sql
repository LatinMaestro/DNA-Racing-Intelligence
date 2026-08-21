BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('41000000-0000-4000-8000-000000000001', 'synthetic_cleanup_owner'),
  ('41000000-0000-4000-8000-000000000002', 'synthetic_cleanup_other_owner');

INSERT INTO dna.import_upload_batch (
  id, owner_id, idempotency_key, request_fingerprint_sha256,
  state, requested_at, target_expires_at
) VALUES
  (
    '41000000-0000-4000-8000-000000000101',
    '41000000-0000-4000-8000-000000000001',
    'synthetic-cleanup-ready', repeat('a', 64), 'targets_ready',
    '2026-08-22T00:00:00Z', '2026-08-22T01:00:00Z'
  ),
  (
    '41000000-0000-4000-8000-000000000201',
    '41000000-0000-4000-8000-000000000001',
    'synthetic-cleanup-accepted', repeat('b', 64), 'targets_ready',
    '2026-08-22T00:00:00Z', '2026-08-22T01:00:00Z'
  );

INSERT INTO dna.import_upload_file (
  id, owner_id, upload_batch_id, client_file_id, source_family,
  original_file_name, content_type, byte_length, sha256
) VALUES
  (
    '41000000-0000-4000-8000-000000000102',
    '41000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000101',
    'synthetic-file-ready', 'race_merge', 'Synthetic Race Merge.csv',
    'text/csv', 100, repeat('1', 64)
  ),
  (
    '41000000-0000-4000-8000-000000000202',
    '41000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000201',
    'synthetic-file-accepted', 'race_merge', 'Accepted Race Merge.csv',
    'text/csv', 100, repeat('2', 64)
  );

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
  (
    '41000000-0000-4000-8000-000000000102',
    '41000000-0000-4000-8000-000000000001',
    'race_merge', 'Synthetic Race Merge.csv', repeat('1', 64),
    'utf_8', 'race-merge/v1', 'validating', '2026-08-22T00:00:00Z',
    NULL, '2026-08-21T23:00:00Z', '2026-08-21T23:00:00Z', NULL,
    1, 1, 0, 0
  ),
  (
    '41000000-0000-4000-8000-000000000202',
    '41000000-0000-4000-8000-000000000001',
    'race_merge', 'Accepted Race Merge.csv', repeat('2', 64),
    'utf_8', 'race-merge/v1', 'accepted', '2026-08-22T00:00:00Z',
    '2026-08-22T00:01:00Z', '2026-08-21T23:00:00Z',
    '2026-08-21T23:00:00Z', '2026-08-21T23:00:00Z',
    1, 1, 0, 0
  );

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number,
  natural_key, fingerprint_sha256, status
) VALUES (
  '41000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000102',
  1, 'synthetic-cleanup-row', repeat('1', 64), 'ready'
);

SET LOCAL app.owner_id = '41000000-0000-4000-8000-000000000001';
SET LOCAL ROLE dna_app_runtime;

DO $runtime_cleanup$
DECLARE
  v_first record;
  v_replay record;
BEGIN
  BEGIN
    PERFORM * FROM dna.cleanup_import_before_activation(
      '41000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000101',
      repeat('9', 64)::character(64),
      'Attempt cleanup with a stale synthetic fingerprint.',
      '2026-08-22T00:09:00Z'
    );
    RAISE EXCEPTION 'expected fingerprint rejection was not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'pre-activation cleanup fingerprint conflict%' THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO STRICT v_first
  FROM dna.cleanup_import_before_activation(
    '41000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000101',
    repeat('a', 64)::character(64),
    'Remove the bounded synthetic Preview acceptance fixture.',
    '2026-08-22T00:10:00Z'
  );

  SELECT * INTO STRICT v_replay
  FROM dna.cleanup_import_before_activation(
    '41000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000101',
    repeat('a', 64)::character(64),
    'Replay the bounded synthetic Preview cleanup request.',
    '2026-08-22T00:11:00Z'
  );

  IF v_first.status <> 'cleaned'
     OR v_first.file_count <> 1
     OR v_first.staged_batch_count <> 1
     OR v_replay.status <> 'existing'
     OR v_replay.cleanup_id <> v_first.cleanup_id THEN
    RAISE EXCEPTION 'pre-activation cleanup or replay evidence is invalid';
  END IF;

  BEGIN
    PERFORM * FROM dna.cleanup_import_before_activation(
      '41000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000101',
      repeat('a', 64)::character(64),
      'Attempt a cross-owner synthetic cleanup request.',
      '2026-08-22T00:12:00Z'
    );
    RAISE EXCEPTION 'expected owner denial was not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'owner-scoped pre-activation cleanup denied%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM * FROM dna.cleanup_import_before_activation(
      '41000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000201',
      repeat('b', 64)::character(64),
      'Attempt to remove an accepted synthetic import.',
      '2026-08-22T00:13:00Z'
    );
    RAISE EXCEPTION 'expected accepted-import rejection was not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'accepted import requires versioned rollback%' THEN
      RAISE;
    END IF;
  END;
END
$runtime_cleanup$;

RESET ROLE;

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dna.import_upload_batch
    WHERE owner_id = '41000000-0000-4000-8000-000000000001'
      AND id = '41000000-0000-4000-8000-000000000101'
  ) OR EXISTS (
    SELECT 1 FROM dna.import_batch
    WHERE owner_id = '41000000-0000-4000-8000-000000000001'
      AND id = '41000000-0000-4000-8000-000000000102'
  ) OR EXISTS (
    SELECT 1 FROM dna.dataset_staged_record
    WHERE owner_id = '41000000-0000-4000-8000-000000000001'
      AND import_batch_id = '41000000-0000-4000-8000-000000000102'
  ) THEN
    RAISE EXCEPTION 'pre-activation cleanup left synthetic durable state';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.import_pre_activation_cleanup
    WHERE owner_id = '41000000-0000-4000-8000-000000000001'
      AND upload_batch_id = '41000000-0000-4000-8000-000000000101'
      AND file_count = 1
      AND staged_batch_count = 1
  ) THEN
    RAISE EXCEPTION 'pre-activation cleanup audit receipt is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.import_upload_batch
    WHERE owner_id = '41000000-0000-4000-8000-000000000001'
      AND id = '41000000-0000-4000-8000-000000000201'
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.import_batch
    WHERE owner_id = '41000000-0000-4000-8000-000000000001'
      AND id = '41000000-0000-4000-8000-000000000202'
      AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'accepted import was changed by pre-activation cleanup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc proc
    JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(proc.proacl, acldefault('f', proc.proowner))
    ) acl
    WHERE namespace.nspname = 'dna'
      AND proc.proname = 'cleanup_import_before_activation'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'pre-activation cleanup is executable by PUBLIC';
  END IF;
END
$assertions$;

ROLLBACK;

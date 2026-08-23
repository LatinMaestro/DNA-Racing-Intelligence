BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('42000000-0000-4000-8000-000000000001', 'synthetic_confirmation_cleanup_owner'),
  ('42000000-0000-4000-8000-000000000002', 'synthetic_confirmation_cleanup_other');

INSERT INTO dna.import_upload_batch (
  id, owner_id, idempotency_key, request_fingerprint_sha256,
  state, requested_at, target_expires_at
) VALUES
  (
    '42000000-0000-4000-8000-000000000101',
    '42000000-0000-4000-8000-000000000001',
    'confirmation-cleanup-pending', repeat('a', 64), 'targets_ready',
    '2026-08-23T00:00:00Z', '2026-08-23T01:00:00Z'
  ),
  (
    '42000000-0000-4000-8000-000000000201',
    '42000000-0000-4000-8000-000000000001',
    'confirmation-cleanup-queued', repeat('b', 64), 'targets_ready',
    '2026-08-23T00:00:00Z', '2026-08-23T01:00:00Z'
  );

INSERT INTO dna.import_upload_file (
  id, owner_id, upload_batch_id, client_file_id, source_family,
  original_file_name, content_type, byte_length, sha256
) VALUES
  (
    '42000000-0000-4000-8000-000000000102',
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000101',
    'confirmation-cleanup-file-1', 'race_merge', 'Synthetic Pending.csv',
    'text/csv', 100, repeat('1', 64)
  ),
  (
    '42000000-0000-4000-8000-000000000202',
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000201',
    'confirmation-cleanup-file-2', 'race_merge', 'Synthetic Queued.csv',
    'text/csv', 100, repeat('2', 64)
  );

INSERT INTO dna.import_upload_completion (
  id, owner_id, upload_batch_id, idempotency_key,
  upload_request_fingerprint_sha256, state, claimed_at, verified_at
) VALUES
  (
    '42000000-0000-4000-8000-000000000103',
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000101',
    'confirmation-completion-1', repeat('a', 64), 'verified',
    '2026-08-23T00:01:00Z', '2026-08-23T00:02:00Z'
  ),
  (
    '42000000-0000-4000-8000-000000000203',
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000201',
    'confirmation-completion-2', repeat('b', 64), 'verified',
    '2026-08-23T00:01:00Z', '2026-08-23T00:02:00Z'
  );

INSERT INTO dna.import_preview_dispatch (
  id, owner_id, upload_batch_id, completion_id,
  upload_request_fingerprint_sha256, state, verified_at, queued_at
) VALUES
  (
    '42000000-0000-4000-8000-000000000104',
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000101',
    '42000000-0000-4000-8000-000000000103', repeat('a', 64), 'queued',
    '2026-08-23T00:02:00Z', '2026-08-23T00:03:00Z'
  ),
  (
    '42000000-0000-4000-8000-000000000204',
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000201',
    '42000000-0000-4000-8000-000000000203', repeat('b', 64), 'queued',
    '2026-08-23T00:02:00Z', '2026-08-23T00:03:00Z'
  );

INSERT INTO dna.import_prepared_preview (
  owner_id, preview_dispatch_id, upload_batch_id, preview_id,
  upload_request_fingerprint_sha256, upload_manifest_fingerprint_sha256,
  preview_fingerprint_sha256, file_count, source_family_count,
  blocking_issue_count, confirmable, completed_at
) VALUES
  (
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000104',
    '42000000-0000-4000-8000-000000000101', 'preview-confirmation-cleanup-1',
    repeat('a', 64), repeat('3', 64), repeat('c', 64), 1, 1, 0, true,
    '2026-08-23T00:04:00Z'
  ),
  (
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000204',
    '42000000-0000-4000-8000-000000000201', 'preview-confirmation-cleanup-2',
    repeat('b', 64), repeat('4', 64), repeat('d', 64), 1, 1, 0, true,
    '2026-08-23T00:04:00Z'
  );

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
  (
    '42000000-0000-4000-8000-000000000102',
    '42000000-0000-4000-8000-000000000001',
    'race_merge', 'Synthetic Pending.csv', repeat('1', 64),
    'utf_8', 'race-merge/v1', 'validating', '2026-08-23T00:00:00Z',
    1, 0, 1, 0
  ),
  (
    '42000000-0000-4000-8000-000000000202',
    '42000000-0000-4000-8000-000000000001',
    'race_merge', 'Synthetic Queued.csv', repeat('2', 64),
    'utf_8', 'race-merge/v1', 'validating', '2026-08-23T00:00:00Z',
    1, 0, 1, 0
  );

INSERT INTO dna.import_activation_dispatch (
  owner_id, id, update_session_id, preview_dispatch_id, preview_id,
  preview_fingerprint_sha256, idempotency_key, state, confirmed_at,
  queued_at
) VALUES
  (
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000105',
    '42000000-0000-4000-8000-000000000106',
    '42000000-0000-4000-8000-000000000104', 'preview-confirmation-cleanup-1',
    repeat('c', 64), 'confirmation-cleanup-1', 'pending',
    '2026-08-23T00:05:00Z', NULL
  ),
  (
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000205',
    '42000000-0000-4000-8000-000000000206',
    '42000000-0000-4000-8000-000000000204', 'preview-confirmation-cleanup-2',
    repeat('d', 64), 'confirmation-cleanup-2', 'queued',
    '2026-08-23T00:05:00Z', '2026-08-23T00:06:00Z'
  );

SET LOCAL app.owner_id = '42000000-0000-4000-8000-000000000001';
SET LOCAL ROLE dna_app_runtime;

DO $runtime_cleanup$
DECLARE
  v_first record;
  v_replay record;
BEGIN
  BEGIN
    PERFORM * FROM dna.cleanup_confirmed_import_before_dispatch(
      '42000000-0000-4000-8000-000000000002',
      '42000000-0000-4000-8000-000000000101', repeat('a', 64)::character(64),
      'preview-confirmation-cleanup-1', repeat('c', 64)::character(64),
      '42000000-0000-4000-8000-000000000106',
      '42000000-0000-4000-8000-000000000105',
      'Attempt cross-owner confirmed cleanup.', '2026-08-23T00:07:00Z'
    );
    RAISE EXCEPTION 'expected confirmed cleanup owner denial was not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'owner-scoped confirmed import cleanup denied%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM * FROM dna.cleanup_confirmed_import_before_dispatch(
      '42000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000101', repeat('a', 64)::character(64),
      'preview-confirmation-cleanup-1', repeat('9', 64)::character(64),
      '42000000-0000-4000-8000-000000000106',
      '42000000-0000-4000-8000-000000000105',
      'Attempt stale-fingerprint confirmed cleanup.', '2026-08-23T00:08:00Z'
    );
    RAISE EXCEPTION 'expected confirmed cleanup fingerprint rejection was not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'confirmed import cleanup fingerprint or preview conflict%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM * FROM dna.cleanup_confirmed_import_before_dispatch(
      '42000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000201', repeat('b', 64)::character(64),
      'preview-confirmation-cleanup-2', repeat('d', 64)::character(64),
      '42000000-0000-4000-8000-000000000206',
      '42000000-0000-4000-8000-000000000205',
      'Attempt queued confirmed cleanup.', '2026-08-23T00:09:00Z'
    );
    RAISE EXCEPTION 'expected queued confirmation rejection was not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'confirmed import cleanup requires an undispatched pending reservation%' THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO STRICT v_first
  FROM dna.cleanup_confirmed_import_before_dispatch(
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000101', repeat('a', 64)::character(64),
    'preview-confirmation-cleanup-1', repeat('c', 64)::character(64),
    '42000000-0000-4000-8000-000000000106',
    '42000000-0000-4000-8000-000000000105',
    'Remove the bounded synthetic confirmed Preview fixture.',
    '2026-08-23T00:10:00Z'
  );

  SELECT * INTO STRICT v_replay
  FROM dna.cleanup_confirmed_import_before_dispatch(
    '42000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000101', repeat('a', 64)::character(64),
    'preview-confirmation-cleanup-1', repeat('c', 64)::character(64),
    '42000000-0000-4000-8000-000000000106',
    '42000000-0000-4000-8000-000000000105',
    'Replay the bounded synthetic confirmed Preview cleanup.',
    '2026-08-23T00:11:00Z'
  );

  IF v_first.status <> 'cleaned'
     OR v_first.file_count <> 1
     OR v_first.staged_batch_count <> 1
     OR v_replay.status <> 'existing'
     OR v_replay.confirmation_cleanup_id <> v_first.confirmation_cleanup_id
     OR v_replay.pre_activation_cleanup_id <> v_first.pre_activation_cleanup_id THEN
    RAISE EXCEPTION 'confirmed import cleanup or replay evidence is invalid';
  END IF;
END
$runtime_cleanup$;

RESET ROLE;

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dna.import_upload_batch
    WHERE owner_id = '42000000-0000-4000-8000-000000000001'
      AND id = '42000000-0000-4000-8000-000000000101'
  ) OR EXISTS (
    SELECT 1 FROM dna.import_activation_dispatch
    WHERE owner_id = '42000000-0000-4000-8000-000000000001'
      AND id = '42000000-0000-4000-8000-000000000105'
  ) OR EXISTS (
    SELECT 1 FROM dna.import_batch
    WHERE owner_id = '42000000-0000-4000-8000-000000000001'
      AND id = '42000000-0000-4000-8000-000000000102'
  ) THEN
    RAISE EXCEPTION 'confirmed import cleanup left synthetic durable source state';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.import_confirmation_cleanup
    WHERE owner_id = '42000000-0000-4000-8000-000000000001'
      AND upload_batch_id = '42000000-0000-4000-8000-000000000101'
      AND activation_dispatch_id = '42000000-0000-4000-8000-000000000105'
      AND file_count = 1
      AND staged_batch_count = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.import_pre_activation_cleanup
    WHERE owner_id = '42000000-0000-4000-8000-000000000001'
      AND upload_batch_id = '42000000-0000-4000-8000-000000000101'
  ) THEN
    RAISE EXCEPTION 'confirmed import cleanup audit receipts are unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.import_activation_dispatch
    WHERE owner_id = '42000000-0000-4000-8000-000000000001'
      AND id = '42000000-0000-4000-8000-000000000205'
      AND state = 'queued'
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.import_upload_batch
    WHERE owner_id = '42000000-0000-4000-8000-000000000001'
      AND id = '42000000-0000-4000-8000-000000000201'
  ) THEN
    RAISE EXCEPTION 'queued confirmation was changed by cleanup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc proc
    JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(proc.proacl, acldefault('f', proc.proowner))
    ) acl
    WHERE namespace.nspname = 'dna'
      AND proc.proname = 'cleanup_confirmed_import_before_dispatch'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'confirmed import cleanup is executable by PUBLIC';
  END IF;
END
$assertions$;

ROLLBACK;

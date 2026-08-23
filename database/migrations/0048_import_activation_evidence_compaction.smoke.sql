BEGIN;

SET LOCAL app.owner_id = '48000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '48000000-0000-4000-8000-000000000001',
  'synthetic_activation_evidence_compaction_owner'
);

INSERT INTO dna.import_upload_batch (
  id, owner_id, idempotency_key, request_fingerprint_sha256, state,
  requested_at, target_expires_at
) VALUES (
  '48000000-0000-4000-8000-000000000101',
  '48000000-0000-4000-8000-000000000001',
  'activation-compaction-upload', repeat('a', 64), 'targets_ready',
  '2026-08-23T09:00:00Z', '2026-08-23T10:00:00Z'
);

INSERT INTO dna.import_upload_file (
  id, owner_id, upload_batch_id, client_file_id, source_family,
  original_file_name, content_type, byte_length, sha256
) VALUES (
  '48000000-0000-4000-8000-000000000102',
  '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000101',
  'core-details-1', 'core_details', 'Core Details.csv',
  'text/csv', 100, repeat('b', 64)
);

INSERT INTO dna.import_upload_completion (
  id, owner_id, upload_batch_id, idempotency_key,
  upload_request_fingerprint_sha256, state, claimed_at, verified_at
) VALUES (
  '48000000-0000-4000-8000-000000000103',
  '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000101',
  'activation-compaction-completion', repeat('a', 64), 'verified',
  '2026-08-23T09:01:00Z', '2026-08-23T09:02:00Z'
);

INSERT INTO dna.import_preview_dispatch (
  id, owner_id, upload_batch_id, completion_id,
  upload_request_fingerprint_sha256, state, verified_at, queued_at
) VALUES (
  '48000000-0000-4000-8000-000000000104',
  '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000101',
  '48000000-0000-4000-8000-000000000103',
  repeat('a', 64), 'queued',
  '2026-08-23T09:02:00Z', '2026-08-23T09:03:00Z'
);

INSERT INTO dna.import_verified_upload_object (
  owner_id, preview_dispatch_id, upload_batch_id, upload_file_id,
  object_id, object_version, advertised_byte_length,
  advertised_content_type, provider_sha256, verified_at
) VALUES (
  '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000104',
  '48000000-0000-4000-8000-000000000101',
  '48000000-0000-4000-8000-000000000102',
  '48000000-0000-4000-8000-000000000102', 'v1', 100,
  'text/csv', repeat('b', 64), '2026-08-23T09:02:00Z'
);

INSERT INTO dna.import_prepared_preview (
  owner_id, preview_dispatch_id, upload_batch_id, preview_id,
  upload_request_fingerprint_sha256, upload_manifest_fingerprint_sha256,
  preview_fingerprint_sha256, file_count, source_family_count,
  blocking_issue_count, confirmable, completed_at
) VALUES (
  '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000104',
  '48000000-0000-4000-8000-000000000101',
  'preview-activation-compaction',
  repeat('a', 64), repeat('c', 64), repeat('d', 64),
  1, 1, 0, true, '2026-08-23T09:04:00Z'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '48000000-0000-4000-8000-000000000102',
  '48000000-0000-4000-8000-000000000001',
  'core_details', 'Core Details.csv', repeat('b', 64),
  'utf_8', 'core-details/v1', 'validating',
  '2026-08-23T09:00:00Z', 1, 0, 1, 0
);

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number, natural_key,
  fingerprint_sha256, status
) VALUES (
  '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000102',
  1, 'core-activation-1', repeat('b', 64), 'ready'
);

INSERT INTO dna.normalized_core_staged_fact (
  owner_id, import_batch_id, source_row_number,
  source_core_id, display_name, core_class, element, f_number, sex
) VALUES (
  '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000102',
  1, 'core-activation-1', 'Activation Core',
  'Genesis', 'Fire', 1, 'female'
);

SELECT * FROM dna.register_dataset_evidence_object(
  '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000102',
  'core_details', 'normalized_partition', 0, 'ndjson_gzip',
  'owners/48000000-0000-4000-8000-000000000001/evidence/activation-part-0000.ndjson.gz',
  repeat('e', 64), 256, 1, 'core-activation-1', 'core-activation-1',
  '2026-08-23T09:04:00Z'
);

DO $prepare_activation$
DECLARE
  v_reserved record;
  v_claimed record;
  v_prepared record;
BEGIN
  SELECT * INTO STRICT v_reserved FROM dna.reserve_import_activation(
    '48000000-0000-4000-8000-000000000001',
    'preview-activation-compaction', repeat('d', 64)::character(64),
    'confirm-activation-compaction', '2026-08-23T09:05:00Z'
  );
  PERFORM dna.mark_import_activation_dispatch_queued(
    '48000000-0000-4000-8000-000000000001',
    v_reserved.update_session_id, v_reserved.dispatch_id,
    '2026-08-23T09:06:00Z'
  );
  SELECT * INTO STRICT v_claimed FROM dna.claim_import_activation_dispatch(
    '48000000-0000-4000-8000-000000000001',
    v_reserved.dispatch_id, 'activation-compaction-worker',
    '2026-08-23T09:07:00Z', '2026-08-23T09:17:00Z'
  );
  IF v_claimed.status <> 'claimed' THEN
    RAISE EXCEPTION 'activation compaction work was not claimed';
  END IF;

  SELECT * INTO STRICT v_prepared
  FROM dna.prepare_import_activation_dataset(
    '48000000-0000-4000-8000-000000000001',
    v_reserved.update_session_id, v_reserved.dispatch_id,
    repeat('d', 64)::character(64), 24
  );
  IF v_prepared.source_version_count <> 1 THEN
    RAISE EXCEPTION 'activation compaction fixture was not prepared';
  END IF;
END
$prepare_activation$;

DO $compaction_assertions$
DECLARE
  v_update_session_id uuid := md5(
    '48000000-0000-4000-8000-000000000001:activation_session:' ||
    '48000000-0000-4000-8000-000000000104'
  )::uuid;
  v_dispatch_id uuid;
  v_result record;
  v_replay record;
BEGIN
  v_dispatch_id := md5(v_update_session_id::text || ':dispatch')::uuid;

  SELECT * INTO STRICT v_result
  FROM dna.compact_import_activation_dataset_evidence(
    '48000000-0000-4000-8000-000000000001',
    v_update_session_id, v_dispatch_id,
    '2026-08-23T09:08:00Z', 24
  );
  IF v_result.status <> 'compacted'
     OR v_result.source_version_count <> 1
     OR v_result.deleted_staged_record_count <> 1
     OR v_result.deleted_contribution_count <> 1 THEN
    RAISE EXCEPTION 'activation evidence compaction result is incorrect';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.compact_import_activation_dataset_evidence(
    '48000000-0000-4000-8000-000000000001',
    v_update_session_id, v_dispatch_id,
    '2026-08-23T09:09:00Z', 24
  );
  IF v_replay.status <> 'existing'
     OR v_replay.source_version_count <> 1 THEN
    RAISE EXCEPTION 'activation evidence compaction replay is not idempotent';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.dataset_staged_record
    WHERE owner_id = '48000000-0000-4000-8000-000000000001'
      AND import_batch_id = '48000000-0000-4000-8000-000000000102'
  )
  OR EXISTS (
    SELECT 1 FROM dna.dataset_record_contribution
    WHERE owner_id = '48000000-0000-4000-8000-000000000001'
      AND import_batch_id = '48000000-0000-4000-8000-000000000102'
  )
  OR NOT EXISTS (
    SELECT 1 FROM dna.dataset_version
    WHERE owner_id = '48000000-0000-4000-8000-000000000001'
      AND import_batch_id = '48000000-0000-4000-8000-000000000102'
      AND is_active
  )
  OR NOT EXISTS (
    SELECT 1 FROM dna.dataset_evidence_object
    WHERE owner_id = '48000000-0000-4000-8000-000000000001'
      AND import_batch_id = '48000000-0000-4000-8000-000000000102'
      AND object_kind = 'normalized_partition'
  )
  OR NOT EXISTS (
    SELECT 1 FROM dna.dataset_evidence_compaction_receipt
    WHERE owner_id = '48000000-0000-4000-8000-000000000001'
      AND import_batch_id = '48000000-0000-4000-8000-000000000102'
  ) THEN
    RAISE EXCEPTION 'activation compaction removed durable accepted evidence';
  END IF;
END
$compaction_assertions$;

DO $security_assertions$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.compact_import_activation_dataset_evidence(uuid,uuid,uuid,timestamp with time zone,integer)',
    'EXECUTE'
  )
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) privilege
    WHERE routine.oid =
      'dna.compact_import_activation_dataset_evidence(uuid,uuid,uuid,timestamp with time zone,integer)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'activation evidence compaction security boundary is unsafe';
  END IF;
END
$security_assertions$;

ROLLBACK;

BEGIN;

SET LOCAL app.owner_id = '38000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('38000000-0000-4000-8000-000000000001', 'synthetic_activation_owner');

INSERT INTO dna.import_upload_batch (
  id, owner_id, idempotency_key, request_fingerprint_sha256, state,
  requested_at, target_expires_at
) VALUES (
  '38000000-0000-4000-8000-000000000101',
  '38000000-0000-4000-8000-000000000001', 'upload-1', repeat('a', 64),
  'targets_ready', '2026-08-20T00:00:00Z', '2026-08-20T01:00:00Z'
);
INSERT INTO dna.import_upload_file (
  id, owner_id, upload_batch_id, client_file_id, source_family,
  original_file_name, content_type, byte_length, sha256
) VALUES (
  '38000000-0000-4000-8000-000000000102',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000101', 'race-1', 'race_merge',
  'synthetic-race.csv', 'text/csv', 100, repeat('b', 64)
);
INSERT INTO dna.import_upload_completion (
  id, owner_id, upload_batch_id, idempotency_key,
  upload_request_fingerprint_sha256, state, claimed_at, verified_at
) VALUES (
  '38000000-0000-4000-8000-000000000103',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000101', 'completion-1', repeat('a', 64),
  'verified', '2026-08-20T00:01:00Z', '2026-08-20T00:02:00Z'
);
INSERT INTO dna.import_preview_dispatch (
  id, owner_id, upload_batch_id, completion_id,
  upload_request_fingerprint_sha256, state, verified_at, queued_at
) VALUES (
  '38000000-0000-4000-8000-000000000104',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000101',
  '38000000-0000-4000-8000-000000000103', repeat('a', 64), 'queued',
  '2026-08-20T00:02:00Z', '2026-08-20T00:03:00Z'
);
INSERT INTO dna.import_verified_upload_object (
  owner_id, preview_dispatch_id, upload_batch_id, upload_file_id, object_id,
  object_version, advertised_byte_length, advertised_content_type,
  provider_sha256, verified_at
) VALUES (
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000104',
  '38000000-0000-4000-8000-000000000101',
  '38000000-0000-4000-8000-000000000102',
  '38000000-0000-4000-8000-000000000102', 'v1', 100, 'text/csv',
  repeat('b', 64), '2026-08-20T00:02:00Z'
);
INSERT INTO dna.import_prepared_preview (
  owner_id, preview_dispatch_id, upload_batch_id, preview_id,
  upload_request_fingerprint_sha256, upload_manifest_fingerprint_sha256,
  preview_fingerprint_sha256, file_count, source_family_count,
  blocking_issue_count, confirmable, completed_at
) VALUES (
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000104',
  '38000000-0000-4000-8000-000000000101', 'preview-activation-1',
  repeat('a', 64), repeat('c', 64), repeat('d', 64), 1, 1, 0, true,
  '2026-08-20T00:04:00Z'
);
INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256, raw_object_key,
  detected_encoding, schema_version, status, uploaded_at, import_completed_at,
  minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
) VALUES (
  '38000000-0000-4000-8000-000000000102',
  '38000000-0000-4000-8000-000000000001', 'race_merge',
  'synthetic-race.csv', repeat('b', 64),
  '38000000-0000-4000-8000-000000000102', 'utf_8', 'race-merge/v1',
  'accepted', '2026-08-20T00:00:00Z', '2026-08-20T00:05:00Z',
  '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z',
  '2026-08-19T00:00:00Z', 2, 1, 1, 1
);
INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
) VALUES (
  '38000000-0000-4000-8000-000000000201',
  '38000000-0000-4000-8000-000000000001', 'race_merge', 1,
  '38000000-0000-4000-8000-000000000102', '2026-08-20T00:06:00Z',
  '2026-08-19T00:00:00Z', true
);
INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
) VALUES (
  '38000000-0000-4000-8000-000000000301',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000201', 'queued'
);

DO $activation_assertions$
DECLARE
  v_reserved record;
  v_replay record;
  v_claim record;
  v_lease record;
BEGIN
  SELECT * INTO STRICT v_reserved FROM dna.reserve_import_activation(
    '38000000-0000-4000-8000-000000000001', 'preview-activation-1',
    repeat('d', 64)::character(64), 'confirm-1', '2026-08-20T00:07:00Z'
  );
  IF v_reserved.disposition <> 'created' OR v_reserved.dispatch_state <> 'pending' THEN
    RAISE EXCEPTION 'activation reservation was not created';
  END IF;
  PERFORM dna.mark_import_activation_dispatch_queued(
    '38000000-0000-4000-8000-000000000001', v_reserved.update_session_id,
    v_reserved.dispatch_id, '2026-08-20T00:08:00Z'
  );
  SELECT * INTO STRICT v_replay FROM dna.reserve_import_activation(
    '38000000-0000-4000-8000-000000000001', 'preview-activation-1',
    repeat('d', 64)::character(64), 'confirm-1', '2026-08-20T00:09:00Z'
  );
  IF v_replay.disposition <> 'existing' OR v_replay.dispatch_state <> 'queued'
     OR v_replay.dispatch_id <> v_reserved.dispatch_id THEN
    RAISE EXCEPTION 'activation reservation replay was not idempotent';
  END IF;
  SELECT * INTO STRICT v_claim FROM dna.claim_import_activation_dispatch(
    '38000000-0000-4000-8000-000000000001', v_reserved.dispatch_id,
    'activation-worker-1', '2026-08-20T00:10:00Z', '2026-08-20T00:15:00Z'
  );
  IF v_claim.status <> 'claimed'
     OR v_claim.authenticated_owner_id <> 'synthetic_activation_owner'
     OR v_claim.preview_fingerprint_sha256 <> repeat('d', 64)::character(64) THEN
    RAISE EXCEPTION 'activation work was not claimed with owner evidence';
  END IF;
  SELECT * INTO STRICT v_lease FROM dna.claim_import_activation_dispatch(
    '38000000-0000-4000-8000-000000000001', v_reserved.dispatch_id,
    'activation-worker-2', '2026-08-20T00:11:00Z', '2026-08-20T00:16:00Z'
  );
  IF v_lease.status <> 'leased_elsewhere'
     OR v_lease.retry_after <> '2026-08-20T00:15:00Z'::timestamptz THEN
    RAISE EXCEPTION 'activation lease boundary was not preserved';
  END IF;
  PERFORM dna.complete_import_activation(
    '38000000-0000-4000-8000-000000000001', v_reserved.update_session_id,
    v_reserved.dispatch_id, 'prepared-result-1', '2026-08-20T00:12:00Z',
    1, 1, true
  );
  SELECT * INTO STRICT v_replay FROM dna.claim_import_activation_dispatch(
    '38000000-0000-4000-8000-000000000001', v_reserved.dispatch_id,
    'activation-worker-replay', '2026-08-20T00:13:00Z',
    '2026-08-20T00:18:00Z'
  );
  IF v_replay.status <> 'already_complete'
     OR v_replay.update_session_id <> v_reserved.update_session_id THEN
    RAISE EXCEPTION 'activation completion replay was not idempotent';
  END IF;
END
$activation_assertions$;

CREATE ROLE dna_ci_activation_worker NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_activation_worker;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_activation_worker;
GRANT EXECUTE ON FUNCTION dna.claim_import_activation_dispatch(
  uuid, uuid, text, timestamptz, timestamptz
) TO dna_ci_activation_worker;
SET LOCAL ROLE dna_ci_activation_worker;
SET LOCAL app.owner_id = '38000000-0000-4000-8000-000000000001';
DO $activation_privilege_assertions$
BEGIN
  BEGIN
    PERFORM * FROM dna.import_activation_processing;
    RAISE EXCEPTION 'worker received direct activation table access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$activation_privilege_assertions$;
RESET ROLE;

ROLLBACK;

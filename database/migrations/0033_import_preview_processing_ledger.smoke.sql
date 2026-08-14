BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('81111111-1111-4111-8111-111111111111', 'preview-processing-owner-1'),
  ('82222222-2222-4222-8222-222222222222', 'preview-processing-owner-2');

SELECT set_config('app.owner_id', '81111111-1111-4111-8111-111111111111', true);

INSERT INTO dna.import_upload_batch (
  id, owner_id, idempotency_key, request_fingerprint_sha256,
  state, requested_at, target_expires_at
) VALUES (
  '83333333-3333-4333-8333-333333333333',
  '81111111-1111-4111-8111-111111111111',
  'preview-processing-batch', repeat('a', 64)::character(64),
  'targets_ready', '2026-08-14T01:00:00.000Z', '2026-08-14T03:00:00.000Z'
);

INSERT INTO dna.import_upload_file (
  id, owner_id, upload_batch_id, client_file_id, source_family,
  original_file_name, content_type, byte_length, sha256
) VALUES (
  '84444444-4444-4444-8444-444444444444',
  '81111111-1111-4111-8111-111111111111',
  '83333333-3333-4333-8333-333333333333',
  'race-merge-1', 'race_merge', 'Race Merge 1.csv',
  'text/csv', 1024, repeat('b', 64)::character(64)
);

INSERT INTO dna.import_upload_completion (
  id, owner_id, upload_batch_id, idempotency_key,
  upload_request_fingerprint_sha256, state, claimed_at, verified_at
) VALUES (
  '85555555-5555-4555-8555-555555555555',
  '81111111-1111-4111-8111-111111111111',
  '83333333-3333-4333-8333-333333333333',
  'complete-request', repeat('a', 64)::character(64),
  'verified', '2026-08-14T01:10:00.000Z', '2026-08-14T01:12:00.000Z'
);

INSERT INTO dna.import_preview_dispatch (
  id, owner_id, upload_batch_id, completion_id,
  upload_request_fingerprint_sha256, state, verified_at, queued_at
) VALUES (
  '86666666-6666-4666-8666-666666666666',
  '81111111-1111-4111-8111-111111111111',
  '83333333-3333-4333-8333-333333333333',
  '85555555-5555-4555-8555-555555555555',
  repeat('a', 64)::character(64), 'queued',
  '2026-08-14T01:12:00.000Z', '2026-08-14T01:13:00.000Z'
);

INSERT INTO dna.import_verified_upload_object (
  owner_id, preview_dispatch_id, upload_batch_id, upload_file_id,
  object_id, object_version, advertised_byte_length,
  advertised_content_type, provider_sha256, verified_at
) VALUES (
  '81111111-1111-4111-8111-111111111111',
  '86666666-6666-4666-8666-666666666666',
  '83333333-3333-4333-8333-333333333333',
  '84444444-4444-4444-8444-444444444444',
  '84444444-4444-4444-8444-444444444444',
  'r2-version-1', 1024, 'text/csv',
  repeat('b', 64)::character(64), '2026-08-14T01:12:00.000Z'
);

DO $smoke$
DECLARE
  v_claim record;
  v_lease record;
  v_publish record;
  v_replay record;
BEGIN
  SELECT * INTO STRICT v_claim FROM dna.claim_import_preview_dispatch(
    '81111111-1111-4111-8111-111111111111',
    '86666666-6666-4666-8666-666666666666',
    'worker-1', repeat('a', 64)::character(64),
    '2026-08-14T01:20:00.000Z', '2026-08-14T01:25:00.000Z'
  );
  IF v_claim.status <> 'claimed'
     OR v_claim.authenticated_owner_id <> 'preview-processing-owner-1'
     OR v_claim.upload_manifest_fingerprint_sha256 IS NULL
     OR jsonb_array_length(v_claim.files) <> 1
     OR v_claim.files->0->>'sourceFamily' <> 'race_merge' THEN
    RAISE EXCEPTION 'preview processing claim evidence is invalid';
  END IF;

  SELECT * INTO STRICT v_lease FROM dna.claim_import_preview_dispatch(
    '81111111-1111-4111-8111-111111111111',
    '86666666-6666-4666-8666-666666666666',
    'worker-2', repeat('a', 64)::character(64),
    '2026-08-14T01:21:00.000Z', '2026-08-14T01:26:00.000Z'
  );
  IF v_lease.status <> 'leased_elsewhere'
     OR v_lease.retry_after <> '2026-08-14T01:25:00.000Z'::timestamptz THEN
    RAISE EXCEPTION 'active Preview lease was not preserved';
  END IF;

  SELECT * INTO STRICT v_publish FROM dna.publish_import_prepared_preview(
    '81111111-1111-4111-8111-111111111111',
    '83333333-3333-4333-8333-333333333333',
    '86666666-6666-4666-8666-666666666666',
    repeat('a', 64)::character(64),
    v_claim.upload_manifest_fingerprint_sha256,
    'preview-1', repeat('c', 64)::character(64),
    1, 1, 0, true, '2026-08-14T01:23:00.000Z'
  );
  IF v_publish.disposition <> 'created'
     OR v_publish.preview_id <> 'preview-1'
     OR NOT v_publish.confirmable THEN
    RAISE EXCEPTION 'prepared Preview publication is invalid';
  END IF;

  SELECT * INTO STRICT v_replay FROM dna.claim_import_preview_dispatch(
    '81111111-1111-4111-8111-111111111111',
    '86666666-6666-4666-8666-666666666666',
    'worker-3', repeat('a', 64)::character(64),
    '2026-08-14T01:24:00.000Z', '2026-08-14T01:29:00.000Z'
  );
  IF v_replay.status <> 'already_complete'
     OR v_replay.preview_id <> 'preview-1'
     OR v_replay.preview_fingerprint_sha256 <> repeat('c', 64) THEN
    RAISE EXCEPTION 'completed Preview replay is invalid';
  END IF;
END
$smoke$;

SET LOCAL ROLE dna_app_runtime;
SELECT set_config('app.owner_id', '82222222-2222-4222-8222-222222222222', true);
DO $smoke$
BEGIN
  IF EXISTS (SELECT 1 FROM dna.import_preview_processing)
     OR EXISTS (SELECT 1 FROM dna.import_prepared_preview) THEN
    RAISE EXCEPTION 'cross-owner Preview processing rows are visible';
  END IF;
  BEGIN
    INSERT INTO dna.import_prepared_preview (
      owner_id, preview_dispatch_id, upload_batch_id, preview_id,
      upload_request_fingerprint_sha256,
      upload_manifest_fingerprint_sha256,
      preview_fingerprint_sha256, file_count, source_family_count,
      blocking_issue_count, confirmable, completed_at
    ) VALUES (
      '82222222-2222-4222-8222-222222222222',
      '86666666-6666-4666-8666-666666666666',
      '83333333-3333-4333-8333-333333333333',
      'forbidden', repeat('d',64), repeat('e',64), repeat('f',64),
      1, 1, 0, true, now()
    );
    RAISE EXCEPTION 'direct runtime Preview write was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$smoke$;
RESET ROLE;
ROLLBACK;

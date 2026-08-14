BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('71111111-1111-4111-8111-111111111111', 'completion-ledger-owner-1'),
  ('72222222-2222-4222-8222-222222222222', 'completion-ledger-owner-2');

SELECT set_config(
  'app.owner_id',
  '71111111-1111-4111-8111-111111111111',
  true
);

INSERT INTO dna.import_upload_batch (
  id, owner_id, idempotency_key, request_fingerprint_sha256,
  state, requested_at, target_expires_at
) VALUES (
  '73333333-3333-4333-8333-333333333333',
  '71111111-1111-4111-8111-111111111111',
  'completion-ledger-batch',
  repeat('a', 64)::character(64),
  'targets_ready',
  '2026-08-14T00:00:00.000Z',
  '2026-08-14T01:00:00.000Z'
);

INSERT INTO dna.import_upload_file (
  id, owner_id, upload_batch_id, client_file_id, source_family,
  original_file_name, content_type, byte_length, sha256
) VALUES (
  '74444444-4444-4444-8444-444444444444',
  '71111111-1111-4111-8111-111111111111',
  '73333333-3333-4333-8333-333333333333',
  'race-merge-1',
  'race_merge',
  'Race Merge 1.csv',
  'text/csv',
  1024,
  repeat('b', 64)::character(64)
);

DO $smoke$
DECLARE
  v_claim record;
  v_replay record;
  v_dispatch record;
  v_completion_id uuid;
BEGIN
  SELECT * INTO STRICT v_claim
  FROM dna.claim_import_upload_completion(
    '71111111-1111-4111-8111-111111111111',
    '73333333-3333-4333-8333-333333333333',
    'complete-request-1',
    repeat('a', 64)::character(64),
    '2026-08-14T00:10:00.000Z'
  );

  IF v_claim.status <> 'claimed'
     OR v_claim.completion_id IS NULL
     OR v_claim.upload_request_fingerprint_sha256 <> repeat('a', 64)
     OR v_claim.file_count <> 1
     OR jsonb_array_length(v_claim.reserved_files) <> 1
     OR v_claim.reserved_files->0->>'uploadFileId'
       <> '74444444-4444-4444-8444-444444444444'
     OR v_claim.reserved_files->0->>'objectId'
       <> '74444444-4444-4444-8444-444444444444' THEN
    RAISE EXCEPTION 'upload completion claim evidence is invalid';
  END IF;
  v_completion_id := v_claim.completion_id;

  PERFORM dna.record_import_upload_verification_failure(
    '71111111-1111-4111-8111-111111111111',
    '73333333-3333-4333-8333-333333333333',
    v_completion_id,
    '2026-08-14T00:11:00.000Z',
    'object_store_unavailable'
  );

  IF NOT EXISTS (
    SELECT 1 FROM dna.import_upload_completion completion
    WHERE completion.id = v_completion_id
      AND completion.state = 'verification_failed'
      AND completion.failure_reason = 'object_store_unavailable'
  ) THEN
    RAISE EXCEPTION 'verification failure was not durable';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.claim_import_upload_completion(
    '71111111-1111-4111-8111-111111111111',
    '73333333-3333-4333-8333-333333333333',
    'complete-request-1',
    repeat('a', 64)::character(64),
    '2026-08-14T00:12:00.000Z'
  );
  IF v_replay.status <> 'claimed'
     OR v_replay.completion_id <> v_completion_id THEN
    RAISE EXCEPTION 'completion retry was not idempotent';
  END IF;

  SELECT * INTO STRICT v_dispatch
  FROM dna.reserve_import_preview_dispatch(
    '71111111-1111-4111-8111-111111111111',
    '73333333-3333-4333-8333-333333333333',
    v_completion_id,
    repeat('a', 64)::character(64),
    '2026-08-14T00:13:00.000Z',
    jsonb_build_array(jsonb_build_object(
      'upload_file_id', '74444444-4444-4444-8444-444444444444',
      'object_id', '74444444-4444-4444-8444-444444444444',
      'object_version', 'r2-version-1',
      'advertised_byte_length', 1024,
      'advertised_content_type', 'text/csv',
      'provider_sha256', repeat('b', 64),
      'scope', 'private_owner',
      'owner_id', '71111111-1111-4111-8111-111111111111',
      'upload_batch_id', '73333333-3333-4333-8333-333333333333'
    ))
  );

  IF v_dispatch.disposition <> 'created'
     OR v_dispatch.dispatch_state <> 'pending'
     OR v_dispatch.preview_dispatch_id IS NULL THEN
    RAISE EXCEPTION 'preview dispatch reservation is invalid';
  END IF;

  PERFORM dna.mark_import_preview_dispatch_failed(
    '71111111-1111-4111-8111-111111111111',
    '73333333-3333-4333-8333-333333333333',
    v_dispatch.preview_dispatch_id,
    '2026-08-14T00:14:00.000Z'
  );

  SELECT * INTO STRICT v_replay
  FROM dna.reserve_import_preview_dispatch(
    '71111111-1111-4111-8111-111111111111',
    '73333333-3333-4333-8333-333333333333',
    v_completion_id,
    repeat('a', 64)::character(64),
    '2026-08-14T00:15:00.000Z',
    jsonb_build_array(jsonb_build_object(
      'upload_file_id', '74444444-4444-4444-8444-444444444444',
      'object_id', '74444444-4444-4444-8444-444444444444',
      'object_version', 'r2-version-1',
      'advertised_byte_length', 1024,
      'advertised_content_type', 'text/csv',
      'provider_sha256', repeat('b', 64),
      'scope', 'private_owner',
      'owner_id', '71111111-1111-4111-8111-111111111111',
      'upload_batch_id', '73333333-3333-4333-8333-333333333333'
    ))
  );

  IF v_replay.disposition <> 'existing'
     OR v_replay.dispatch_state <> 'pending'
     OR v_replay.preview_dispatch_id <> v_dispatch.preview_dispatch_id THEN
    RAISE EXCEPTION 'failed dispatch retry was not idempotent';
  END IF;

  PERFORM dna.mark_import_preview_dispatch_queued(
    '71111111-1111-4111-8111-111111111111',
    '73333333-3333-4333-8333-333333333333',
    v_dispatch.preview_dispatch_id,
    '2026-08-14T00:16:00.000Z'
  );

  SELECT * INTO STRICT v_replay
  FROM dna.claim_import_upload_completion(
    '71111111-1111-4111-8111-111111111111',
    '73333333-3333-4333-8333-333333333333',
    'another-completion-key',
    repeat('a', 64)::character(64),
    '2026-08-14T00:17:00.000Z'
  );
  IF v_replay.status <> 'already_queued'
     OR v_replay.preview_dispatch_id <> v_dispatch.preview_dispatch_id
     OR v_replay.file_count <> 1 THEN
    RAISE EXCEPTION 'queued dispatch replay evidence is invalid';
  END IF;

  BEGIN
    PERFORM dna.reserve_import_preview_dispatch(
      '71111111-1111-4111-8111-111111111111',
      '73333333-3333-4333-8333-333333333333',
      v_completion_id,
      repeat('a', 64)::character(64),
      '2026-08-14T00:18:00.000Z',
      jsonb_build_array(jsonb_build_object(
        'upload_file_id', '74444444-4444-4444-8444-444444444444',
        'object_id', '74444444-4444-4444-8444-444444444444',
        'object_version', 'drifted-version',
        'advertised_byte_length', 1024,
        'advertised_content_type', 'text/csv',
        'provider_sha256', repeat('b', 64),
        'scope', 'private_owner',
        'owner_id', '71111111-1111-4111-8111-111111111111',
        'upload_batch_id', '73333333-3333-4333-8333-333333333333'
      ))
    );
    RAISE EXCEPTION 'verified upload replay drift was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'verified upload replay drift was accepted' THEN RAISE; END IF;
  END;
END
$smoke$;

DO $smoke$
BEGIN
  BEGIN
    PERFORM dna.claim_import_upload_completion(
      '72222222-2222-4222-8222-222222222222',
      '73333333-3333-4333-8333-333333333333',
      'cross-owner-claim',
      repeat('a', 64)::character(64),
      '2026-08-14T00:20:00.000Z'
    );
    RAISE EXCEPTION 'cross-owner completion claim was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-owner completion claim was accepted' THEN RAISE; END IF;
  END;
END
$smoke$;

SET LOCAL ROLE dna_app_runtime;
SELECT set_config(
  'app.owner_id',
  '72222222-2222-4222-8222-222222222222',
  true
);

DO $smoke$
BEGIN
  IF EXISTS (SELECT 1 FROM dna.import_upload_completion)
     OR EXISTS (SELECT 1 FROM dna.import_preview_dispatch)
     OR EXISTS (SELECT 1 FROM dna.import_verified_upload_object) THEN
    RAISE EXCEPTION 'cross-owner completion ledger rows are visible';
  END IF;
  BEGIN
    INSERT INTO dna.import_upload_completion (
      id, owner_id, upload_batch_id, idempotency_key,
      upload_request_fingerprint_sha256, claimed_at
    ) VALUES (
      gen_random_uuid(),
      '72222222-2222-4222-8222-222222222222',
      '73333333-3333-4333-8333-333333333333',
      'direct-runtime-write',
      repeat('c', 64)::character(64),
      now()
    );
    RAISE EXCEPTION 'direct runtime completion write was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$smoke$;

RESET ROLE;
ROLLBACK;

BEGIN;

SET LOCAL app.owner_id = '39000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('39000000-0000-4000-8000-000000000001', 'synthetic_activation_dataset_owner');

INSERT INTO dna.import_upload_batch (
  id, owner_id, idempotency_key, request_fingerprint_sha256, state,
  requested_at, target_expires_at
) VALUES (
  '39000000-0000-4000-8000-000000000101',
  '39000000-0000-4000-8000-000000000001',
  'activation-dataset-upload', repeat('a', 64), 'targets_ready',
  '2026-08-21T00:00:00Z', '2026-08-21T01:00:00Z'
);

INSERT INTO dna.import_upload_file (
  id, owner_id, upload_batch_id, client_file_id, source_family,
  original_file_name, content_type, byte_length, sha256
)
SELECT
  md5('39000000-0000-4000-8000-000000000001:file:' || item)::uuid,
  '39000000-0000-4000-8000-000000000001'::uuid,
  '39000000-0000-4000-8000-000000000101'::uuid,
  'file-' || item,
  CASE WHEN item = 1 THEN 'core_details'
       WHEN item = 9 THEN 'current_arena'
       ELSE 'race_merge' END,
  CASE WHEN item = 1 THEN 'Core Details.csv'
       WHEN item = 9 THEN 'Current Arena.csv'
       ELSE 'Race Merge ' || (item - 1) || '.csv' END,
  'text/csv', 100,
  repeat((item % 10)::text, 64)::character(64)
FROM generate_series(1, 9) item;

INSERT INTO dna.import_upload_completion (
  id, owner_id, upload_batch_id, idempotency_key,
  upload_request_fingerprint_sha256, state, claimed_at, verified_at
) VALUES (
  '39000000-0000-4000-8000-000000000103',
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000101',
  'activation-dataset-completion', repeat('a', 64), 'verified',
  '2026-08-21T00:01:00Z', '2026-08-21T00:02:00Z'
);

INSERT INTO dna.import_preview_dispatch (
  id, owner_id, upload_batch_id, completion_id,
  upload_request_fingerprint_sha256, state, verified_at, queued_at
) VALUES (
  '39000000-0000-4000-8000-000000000104',
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000101',
  '39000000-0000-4000-8000-000000000103',
  repeat('a', 64), 'queued',
  '2026-08-21T00:02:00Z', '2026-08-21T00:03:00Z'
);

INSERT INTO dna.import_verified_upload_object (
  owner_id, preview_dispatch_id, upload_batch_id, upload_file_id, object_id,
  object_version, advertised_byte_length, advertised_content_type,
  provider_sha256, verified_at
)
SELECT
  file.owner_id, '39000000-0000-4000-8000-000000000104'::uuid,
  file.upload_batch_id, file.id, file.id::text, 'v1',
  file.byte_length, file.content_type, file.sha256, '2026-08-21T00:02:00Z'
FROM dna.import_upload_file file
WHERE file.owner_id = '39000000-0000-4000-8000-000000000001'
  AND file.upload_batch_id = '39000000-0000-4000-8000-000000000101';

INSERT INTO dna.import_prepared_preview (
  owner_id, preview_dispatch_id, upload_batch_id, preview_id,
  upload_request_fingerprint_sha256, upload_manifest_fingerprint_sha256,
  preview_fingerprint_sha256, file_count, source_family_count,
  blocking_issue_count, confirmable, completed_at
) VALUES (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000104',
  '39000000-0000-4000-8000-000000000101',
  'preview-activation-dataset',
  repeat('a', 64), repeat('c', 64), repeat('d', 64),
  9, 3, 0, true, '2026-08-21T00:04:00Z'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  minimum_accepted_event_at, maximum_accepted_event_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
SELECT
  file.id, file.owner_id, file.source_family, file.original_file_name,
  file.sha256, 'utf_8',
  CASE file.source_family
    WHEN 'race_merge' THEN 'race-merge/v1'
    WHEN 'core_details' THEN 'core-details/v1'
    ELSE 'current-arena/v1'
  END,
  'validating',
  '2026-08-21T00:00:00Z'::timestamptz +
    (substring(file.client_file_id from '[0-9]+$')::integer * interval '1 minute'),
  CASE WHEN file.source_family = 'race_merge'
    THEN '2026-08-01T00:00:00Z'::timestamptz +
      (substring(file.client_file_id from '[0-9]+$')::integer * interval '1 day')
    ELSE NULL END,
  CASE WHEN file.source_family = 'race_merge'
    THEN '2026-08-01T00:00:00Z'::timestamptz +
      (substring(file.client_file_id from '[0-9]+$')::integer * interval '1 day')
    ELSE NULL END,
  1, 0, 1, 0
FROM dna.import_upload_file file
WHERE file.owner_id = '39000000-0000-4000-8000-000000000001'
  AND file.upload_batch_id = '39000000-0000-4000-8000-000000000101';

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number,
  natural_key, fingerprint_sha256, status
)
SELECT owner_id, id, 1, 'activation-dataset|' || source_filename,
  checksum_sha256, 'ready'
FROM dna.import_batch
WHERE owner_id = '39000000-0000-4000-8000-000000000001';

INSERT INTO dna.normalized_core_staged_fact (
  owner_id, import_batch_id, source_row_number,
  source_core_id, display_name, core_class, element, f_number, sex
) VALUES (
  '39000000-0000-4000-8000-000000000001',
  md5('39000000-0000-4000-8000-000000000001:file:1')::uuid,
  1, 'activation-core', 'Activation Core', 'Genesis', 'Fire', 1, 'female'
);

INSERT INTO dna.normalized_race_staged_fact (
  owner_id, import_batch_id, source_row_number, source_event_id, event_at,
  mode, distance, source_core_id, source_core_name, source_gate, gate_count,
  gold_star, blue_star, raw_gold_star, raw_blue_star, star_data_status,
  finish_position, elapsed_time_source_value
)
SELECT
  '39000000-0000-4000-8000-000000000001'::uuid,
  md5('39000000-0000-4000-8000-000000000001:file:' || item)::uuid,
  1, 'activation-event-' || item,
  '2026-08-01T00:00:00Z'::timestamptz + (item * interval '1 day'),
  CASE item % 3 WHEN 0 THEN 'bike' WHEN 1 THEN 'car' ELSE 'horse' END,
  1000 + (item * 100), 'activation-core', 'Activation Core', 1, 4,
  false, false, 'FALSE', 'FALSE', 'complete', 1, '50.000'
FROM generate_series(2, 8) item;

INSERT INTO dna.normalized_arena_staged_fact (
  owner_id, import_batch_id, source_row_number,
  source_core_id, price_usd_source_value, creates_economic_transaction
) VALUES (
  '39000000-0000-4000-8000-000000000001',
  md5('39000000-0000-4000-8000-000000000001:file:9')::uuid,
  1, 'activation-core', '125.00', false
);

DO $claim$
DECLARE
  v_reserved record;
  v_claimed record;
BEGIN
  SELECT * INTO STRICT v_reserved FROM dna.reserve_import_activation(
    '39000000-0000-4000-8000-000000000001',
    'preview-activation-dataset', repeat('d', 64)::character(64),
    'confirm-activation-dataset', '2026-08-21T00:05:00Z'
  );
  PERFORM dna.mark_import_activation_dispatch_queued(
    '39000000-0000-4000-8000-000000000001',
    v_reserved.update_session_id, v_reserved.dispatch_id,
    '2026-08-21T00:06:00Z'
  );
  SELECT * INTO STRICT v_claimed FROM dna.claim_import_activation_dispatch(
    '39000000-0000-4000-8000-000000000001',
    v_reserved.dispatch_id, 'activation-dataset-worker',
    '2026-08-21T00:07:00Z', '2026-08-21T00:17:00Z'
  );
  IF v_claimed.status <> 'claimed' THEN
    RAISE EXCEPTION 'activation dataset work was not claimed';
  END IF;
END
$claim$;

DO $reject_25_without_leakage$
BEGIN
  BEGIN
    INSERT INTO dna.import_upload_file (
      id, owner_id, upload_batch_id, client_file_id, source_family,
      original_file_name, content_type, byte_length, sha256
    )
    SELECT md5('39000000-0000-4000-8000-000000000001:file:' || item)::uuid,
      '39000000-0000-4000-8000-000000000001'::uuid,
      '39000000-0000-4000-8000-000000000101'::uuid,
      'file-' || item, 'race_merge', 'Race Merge ' || item || '.csv',
      'text/csv', 100, repeat('a', 64)
    FROM generate_series(10, 25) item;

    INSERT INTO dna.import_verified_upload_object (
      owner_id, preview_dispatch_id, upload_batch_id, upload_file_id,
      object_id, object_version, advertised_byte_length,
      advertised_content_type, provider_sha256, verified_at
    )
    SELECT file.owner_id, '39000000-0000-4000-8000-000000000104'::uuid,
      file.upload_batch_id, file.id, file.id::text, 'v1', 100, 'text/csv',
      file.sha256, '2026-08-21T00:02:00Z'
    FROM dna.import_upload_file file
    WHERE file.owner_id = '39000000-0000-4000-8000-000000000001'
      AND substring(file.client_file_id from '[0-9]+$')::integer BETWEEN 10 AND 25;

    INSERT INTO dna.import_batch (
      id, owner_id, source_type, source_filename, checksum_sha256,
      detected_encoding, schema_version, status, uploaded_at,
      source_rows, accepted_rows, rejected_rows, warning_rows
    )
    SELECT id, owner_id, 'race_merge', original_file_name, sha256,
      'utf_8', 'race-merge/v1', 'validating', '2026-08-21T00:10:00Z',
      1, 0, 1, 0
    FROM dna.import_upload_file
    WHERE owner_id = '39000000-0000-4000-8000-000000000001'
      AND substring(client_file_id from '[0-9]+$')::integer BETWEEN 10 AND 25;

    UPDATE dna.import_prepared_preview
    SET file_count = 25
    WHERE owner_id = '39000000-0000-4000-8000-000000000001'
      AND preview_dispatch_id = '39000000-0000-4000-8000-000000000104';

    PERFORM * FROM dna.prepare_import_activation_dataset(
      '39000000-0000-4000-8000-000000000001',
      md5(
        '39000000-0000-4000-8000-000000000001:activation_session:' ||
        '39000000-0000-4000-8000-000000000104'
      )::uuid,
      md5(
        md5(
          '39000000-0000-4000-8000-000000000001:activation_session:' ||
          '39000000-0000-4000-8000-000000000104'
        )::uuid::text || ':dispatch'
      )::uuid,
      repeat('d', 64)::character(64), 24
    );
    RAISE EXCEPTION 'expected 25-file rejection was not raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'import upload batch exceeds the bounded 24-file contract%'
       AND SQLERRM NOT LIKE 'verified Preview source version count is invalid%' THEN
      RAISE;
    END IF;
  END;

  IF (SELECT count(*) FROM dna.import_upload_file
      WHERE owner_id = '39000000-0000-4000-8000-000000000001') <> 9
     OR (SELECT file_count FROM dna.import_prepared_preview
         WHERE owner_id = '39000000-0000-4000-8000-000000000001'
           AND preview_dispatch_id = '39000000-0000-4000-8000-000000000104') <> 9
     OR EXISTS (
       SELECT 1 FROM dna.dataset_version
       WHERE owner_id = '39000000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION '25-file rejection leaked durable activation state';
  END IF;
END
$reject_25_without_leakage$;

CREATE ROLE dna_ci_activation_dataset NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_activation_dataset;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_activation_dataset;
GRANT EXECUTE ON FUNCTION dna.prepare_import_activation_dataset(
  uuid, uuid, uuid, character, integer
) TO dna_ci_activation_dataset;

SET LOCAL ROLE dna_ci_activation_dataset;
SET LOCAL app.owner_id = '39000000-0000-4000-8000-000000000001';

DO $prepare_and_replay$
DECLARE
  v_first record;
  v_replay record;
  v_update_session_id uuid := md5(
    '39000000-0000-4000-8000-000000000001:activation_session:' ||
    '39000000-0000-4000-8000-000000000104'
  )::uuid;
  v_dispatch_id uuid;
BEGIN
  v_dispatch_id := md5(v_update_session_id::text || ':dispatch')::uuid;
  SELECT * INTO STRICT v_first FROM dna.prepare_import_activation_dataset(
    '39000000-0000-4000-8000-000000000001',
    v_update_session_id, v_dispatch_id, repeat('d', 64)::character(64), 24
  );
  SELECT * INTO STRICT v_replay FROM dna.prepare_import_activation_dataset(
    '39000000-0000-4000-8000-000000000001',
    v_update_session_id, v_dispatch_id, repeat('d', 64)::character(64), 24
  );
  IF v_first.source_version_count <> 9
     OR v_first.quarantined_record_count <> 0
     OR NOT v_first.aggregate_refresh_required
     OR v_first.prepared_result_id <> v_replay.prepared_result_id
     OR v_replay.source_version_count <> 9 THEN
    RAISE EXCEPTION 'nine-file preparation or exact replay evidence is invalid';
  END IF;

  BEGIN
    PERFORM * FROM dna.import_batch;
    RAISE EXCEPTION 'activation dataset worker received direct table access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$prepare_and_replay$;

RESET ROLE;

DO $activation_evidence$
DECLARE
  v_update_session_id uuid := md5(
    '39000000-0000-4000-8000-000000000001:activation_session:' ||
    '39000000-0000-4000-8000-000000000104'
  )::uuid;
  v_dispatch_id uuid;
  v_prepared_result_id text;
BEGIN
  v_dispatch_id := md5(v_update_session_id::text || ':dispatch')::uuid;
  v_prepared_result_id := 'prepared-' || md5(
    '39000000-0000-4000-8000-000000000001:' ||
    v_update_session_id::text || ':' || v_dispatch_id::text || ':' ||
    repeat('d', 64)
  );

  IF (SELECT count(*) FROM dna.dataset_version
      WHERE owner_id = '39000000-0000-4000-8000-000000000001') <> 9
     OR (SELECT count(*) FROM dna.aggregate_refresh_job job
         WHERE job.owner_id = '39000000-0000-4000-8000-000000000001') <> 9
     OR (SELECT count(*) FROM dna.import_batch
         WHERE owner_id = '39000000-0000-4000-8000-000000000001'
           AND status = 'accepted') <> 9
     OR NOT EXISTS (
       SELECT 1 FROM dna.race_entry
       WHERE owner_id = '39000000-0000-4000-8000-000000000001'
         AND source_core_id = 'activation-core'
         AND core_id IS NOT NULL
     )
     OR (SELECT count(*) FROM dna.current_arena_snapshot_entry
         WHERE owner_id = '39000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'atomic activation did not materialize all source families';
  END IF;

  PERFORM dna.complete_import_activation(
    '39000000-0000-4000-8000-000000000001',
    v_update_session_id, v_dispatch_id, v_prepared_result_id,
    '2026-08-21T00:12:00Z', 9, 0, true
  );

  IF NOT EXISTS (
    SELECT 1 FROM dna.import_activation_processing
    WHERE owner_id = '39000000-0000-4000-8000-000000000001'
      AND dispatch_id = v_dispatch_id
      AND state = 'complete'
      AND source_version_count = 9
      AND quarantined_record_count = 0
      AND aggregate_refresh_required
  ) THEN
    RAISE EXCEPTION 'activation completion evidence was not persisted';
  END IF;
END
$activation_evidence$;

ROLLBACK;

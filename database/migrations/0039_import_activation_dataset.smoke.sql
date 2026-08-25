BEGIN;

SET LOCAL app.owner_id = '39000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '39000000-0000-4000-8000-000000000001',
  'synthetic_activation_dataset_owner'
);

INSERT INTO dna.import_update_session (
  id, owner_id, state, created_at, updated_at
) VALUES (
  '39000000-0000-4000-8000-000000000104',
  '39000000-0000-4000-8000-000000000001',
  'staging', '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z'
);

INSERT INTO dna.import_verified_upload_object (
  owner_id, update_session_id, upload_file_id, source_type,
  source_filename, checksum_sha256, byte_size, object_key,
  verification_status, verified_at, detected_schema_version,
  source_rows
)
SELECT
  '39000000-0000-4000-8000-000000000001'::uuid,
  '39000000-0000-4000-8000-000000000104'::uuid,
  ('39000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  CASE WHEN series <= 7 THEN 'race_merge'
       WHEN series = 8 THEN 'core_details'
       ELSE 'current_arena' END,
  CASE WHEN series <= 7 THEN 'race-' || series || '.csv'
       WHEN series = 8 THEN 'cores.csv'
       ELSE 'arena.csv' END,
  lpad(to_hex(series), 64, '0'), 128,
  'private/synthetic/' || series || '.csv', 'verified',
  '2026-08-21T00:01:00Z'::timestamptz,
  CASE WHEN series <= 7 THEN 'race_merge_v1'
       WHEN series = 8 THEN 'core_details_v1'
       ELSE 'current_arena_v1' END,
  1
FROM generate_series(1, 9) AS series;

INSERT INTO dna.preview_import_dispatch (
  id, owner_id, update_session_id, status, created_at, updated_at
) VALUES (
  '39000000-0000-4000-8000-000000000105',
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000104',
  'ready', '2026-08-21T00:02:00Z', '2026-08-21T00:02:00Z'
);

UPDATE dna.import_verified_upload_object
SET preview_dispatch_id = '39000000-0000-4000-8000-000000000105'
WHERE owner_id = '39000000-0000-4000-8000-000000000001';

INSERT INTO dna.import_activation_dispatch (
  id, owner_id, update_session_id, preview_dispatch_id, status,
  confirmation_token_sha256, prepared_result_id, created_at, updated_at
) VALUES (
  '39000000-0000-4000-8000-000000000106',
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000104',
  '39000000-0000-4000-8000-000000000105',
  'confirmed', repeat('d', 64), 'synthetic-prepared-result',
  '2026-08-21T00:03:00Z', '2026-08-21T00:03:00Z'
);

INSERT INTO dna.preview_staged_record (
  owner_id, dispatch_id, upload_file_id, source_type, source_ordinal,
  natural_key, row_fingerprint, normalized_record, observed_at
)
SELECT
  '39000000-0000-4000-8000-000000000001'::uuid,
  '39000000-0000-4000-8000-000000000105'::uuid,
  upload.upload_file_id,
  upload.source_type,
  0,
  CASE upload.source_type
    WHEN 'race_merge' THEN 'race:' || upload.upload_file_id::text
    WHEN 'core_details' THEN 'activation-core'
    ELSE 'activation-arena'
  END,
  repeat('e', 64),
  CASE upload.source_type
    WHEN 'race_merge' THEN jsonb_build_object(
      'race_id', 'race-' || upload.upload_file_id::text,
      'event_id', 'event-' || upload.upload_file_id::text,
      'core_id', 'activation-core',
      'position', 1,
      'mode', 'bike',
      'distance', 1000,
      'race_time', 30.0,
      'race_date', '2026-08-20T00:00:00Z'
    )
    WHEN 'core_details' THEN jsonb_build_object(
      'core_id', 'activation-core',
      'core_name', 'Activation Core',
      'bike_id', 'activation-bike'
    )
    ELSE jsonb_build_object(
      'arena_id', 'activation-arena',
      'arena_name', 'Activation Arena'
    )
  END,
  '2026-08-20T00:00:00Z'::timestamptz
FROM dna.import_verified_upload_object upload
WHERE upload.owner_id = '39000000-0000-4000-8000-000000000001';

CREATE ROLE dna_ci_activation_dataset_worker NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_activation_dataset_worker;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_activation_dataset_worker;
GRANT EXECUTE ON FUNCTION dna.prepare_import_activation_dataset(
  uuid, uuid, uuid, character, integer
) TO dna_ci_activation_dataset_worker;
GRANT EXECUTE ON FUNCTION dna.complete_import_activation(
  uuid, uuid, uuid, text, timestamptz, integer, bigint, boolean
) TO dna_ci_activation_dataset_worker;
GRANT EXECUTE ON FUNCTION dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
) TO dna_ci_activation_dataset_worker;

SET LOCAL ROLE dna_ci_activation_dataset_worker;
SET LOCAL app.owner_id = '39000000-0000-4000-8000-000000000001';

DO $prepare_and_replay$
DECLARE
  v_update_session_id uuid := md5(
    '39000000-0000-4000-8000-000000000001:activation_session:' ||
    '39000000-0000-4000-8000-000000000104'
  )::uuid;
  v_dispatch_id uuid;
  v_first record;
  v_replay record;
BEGIN
  v_dispatch_id := md5(v_update_session_id::text || ':dispatch')::uuid;

  SELECT * INTO STRICT v_first
  FROM dna.prepare_import_activation_dataset(
    '39000000-0000-4000-8000-000000000001',
    v_update_session_id, v_dispatch_id, repeat('d', 64)::character(64), 24
  );
  SELECT * INTO STRICT v_replay
  FROM dna.prepare_import_activation_dataset(
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

  IF (
    SELECT count(*)
    FROM dna.list_import_activation_aggregate_refreshes(
      '39000000-0000-4000-8000-000000000001',
      v_update_session_id, v_dispatch_id, 24
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'active-family aggregate publication set is invalid';
  END IF;
END
$activation_evidence$;

ROLLBACK;
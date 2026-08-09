BEGIN;

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'synthetic-owner-1'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'synthetic-owner-2'
  );

DO $grant_assertions$
BEGIN
  IF
    NOT has_table_privilege(
      'dna_app_runtime', 'dna.import_upload_batch', 'SELECT'
    )
    OR NOT has_table_privilege(
      'dna_app_runtime', 'dna.import_upload_file', 'SELECT'
    )
    OR has_table_privilege(
      'dna_app_runtime',
      'dna.import_upload_batch',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR has_table_privilege(
      'dna_app_runtime',
      'dna.import_upload_file',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  THEN
    RAISE EXCEPTION 'runtime upload reservation grants are not minimal';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    WHERE
      relation.oid IN (
        'dna.import_upload_batch'::regclass,
        'dna.import_upload_file'::regclass
      )
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
    GROUP BY relation.relrowsecurity, relation.relforcerowsecurity
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'upload reservation tables must enable and force RLS';
  END IF;
END
$grant_assertions$;

DO $owner_one_workflow$
DECLARE
  v_files jsonb := jsonb_build_array(
    jsonb_build_object(
      'client_file_id', 'core-1',
      'source_family', 'core_details',
      'original_file_name', 'synthetic-core.csv',
      'content_type', 'text/csv',
      'byte_length', 1024,
      'sha256', repeat('b', 64)
    ),
    jsonb_build_object(
      'client_file_id', 'race-1',
      'source_family', 'race_merge',
      'original_file_name', 'synthetic-race.csv',
      'content_type', 'application/octet-stream',
      'byte_length', 5368709120,
      'sha256', repeat('c', 64)
    )
  );
  v_created record;
  v_replayed record;
  v_conflict record;
  v_upload_file_ids uuid[];
BEGIN
  SELECT * INTO v_created
  FROM dna.reserve_import_upload_batch(
    '11111111-1111-4111-8111-111111111111',
    'synthetic-upload-1',
    repeat('a', 64)::character(64),
    '2026-08-10T00:00:00.000Z',
    v_files
  );

  IF
    v_created.disposition <> 'created'
    OR jsonb_array_length(v_created.reserved_files) <> 2
  THEN
    RAISE EXCEPTION 'first upload reservation was not created completely';
  END IF;

  SELECT * INTO v_replayed
  FROM dna.reserve_import_upload_batch(
    '11111111-1111-4111-8111-111111111111',
    'synthetic-upload-1',
    repeat('a', 64)::character(64),
    '2026-08-10T00:01:00.000Z',
    v_files
  );

  IF
    v_replayed.disposition <> 'existing'
    OR v_replayed.upload_batch_id <> v_created.upload_batch_id
    OR v_replayed.reserved_files <> v_created.reserved_files
  THEN
    RAISE EXCEPTION 'exact upload replay did not reuse durable mappings';
  END IF;

  SELECT * INTO v_conflict
  FROM dna.reserve_import_upload_batch(
    '11111111-1111-4111-8111-111111111111',
    'synthetic-upload-1',
    repeat('d', 64)::character(64),
    '2026-08-10T00:02:00.000Z',
    v_files
  );

  IF
    v_conflict.disposition <> 'existing'
    OR v_conflict.request_fingerprint_sha256 <>
      repeat('a', 64)::character(64)
  THEN
    RAISE EXCEPTION 'conflicting upload replay did not preserve accepted evidence';
  END IF;

  SELECT array_agg(file.id ORDER BY file.id)
  INTO v_upload_file_ids
  FROM dna.import_upload_file file
  WHERE file.upload_batch_id = v_created.upload_batch_id;

  BEGIN
    PERFORM dna.mark_import_upload_targets_ready(
      '11111111-1111-4111-8111-111111111111',
      v_created.upload_batch_id,
      ARRAY[v_upload_file_ids[1]],
      repeat('a', 64)::character(64),
      '2099-01-01T00:00:00.000Z'
    );
    RAISE EXCEPTION 'incomplete upload target file set was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'incomplete upload target file set was accepted' THEN
        RAISE;
      END IF;
  END;

  PERFORM dna.mark_import_upload_targets_ready(
    '11111111-1111-4111-8111-111111111111',
    v_created.upload_batch_id,
    v_upload_file_ids,
    repeat('a', 64)::character(64),
    '2099-01-01T00:00:00.000Z'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_upload_batch batch
    WHERE
      batch.id = v_created.upload_batch_id
      AND batch.state = 'targets_ready'
      AND batch.target_expires_at = '2099-01-01T00:00:00.000Z'
  ) THEN
    RAISE EXCEPTION 'upload target readiness was not persisted';
  END IF;

  SELECT * INTO v_created
  FROM dna.reserve_import_upload_batch(
    '11111111-1111-4111-8111-111111111111',
    'synthetic-upload-failure',
    repeat('e', 64)::character(64),
    '2026-08-10T00:03:00.000Z',
    jsonb_build_array(
      jsonb_build_object(
        'client_file_id', 'vault-1',
        'source_family', 'current_vault',
        'original_file_name', 'synthetic-vault.csv',
        'content_type', 'text/csv',
        'byte_length', 512,
        'sha256', repeat('f', 64)
      )
    )
  );

  PERFORM dna.mark_import_upload_reservation_failed(
    '11111111-1111-4111-8111-111111111111',
    v_created.upload_batch_id,
    repeat('e', 64)::character(64),
    '2026-08-10T00:04:00.000Z'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_upload_batch batch
    WHERE
      batch.id = v_created.upload_batch_id
      AND batch.state = 'failed'
      AND batch.failure_reason = 'private_object_target_unavailable'
  ) THEN
    RAISE EXCEPTION 'upload target failure was not persisted';
  END IF;
END
$owner_one_workflow$;

SELECT set_config(
  'app.owner_id',
  '22222222-2222-4222-8222-222222222222',
  true
);

SELECT *
FROM dna.reserve_import_upload_batch(
  '22222222-2222-4222-8222-222222222222',
  'synthetic-owner-2-upload',
  repeat('1', 64)::character(64),
  '2026-08-10T00:05:00.000Z',
  jsonb_build_array(
    jsonb_build_object(
      'client_file_id', 'arena-1',
      'source_family', 'current_arena',
      'original_file_name', 'synthetic-arena.csv',
      'content_type', 'text/csv',
      'byte_length', 256,
      'sha256', repeat('2', 64)
    )
  )
);

SET LOCAL SESSION AUTHORIZATION dna_app_runtime;

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

DO $runtime_isolation$
BEGIN
  IF
    (SELECT count(*) FROM dna.import_upload_batch) <> 2
    OR (SELECT count(*) FROM dna.import_upload_file) <> 3
  THEN
    RAISE EXCEPTION 'runtime upload SELECT crossed the owner boundary';
  END IF;

  BEGIN
    INSERT INTO dna.import_upload_batch (
      id,
      owner_id,
      idempotency_key,
      request_fingerprint_sha256,
      requested_at
    ) VALUES (
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
      'runtime-direct-insert',
      repeat('3', 64),
      '2026-08-10T00:06:00.000Z'
    );
    RAISE EXCEPTION 'runtime direct upload INSERT was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM *
    FROM dna.reserve_import_upload_batch(
      '22222222-2222-4222-8222-222222222222',
      'runtime-cross-owner',
      repeat('4', 64)::character(64),
      '2026-08-10T00:07:00.000Z',
      jsonb_build_array(
        jsonb_build_object(
          'client_file_id', 'cross-owner-1',
          'source_family', 'core_details',
          'original_file_name', 'synthetic-cross-owner.csv',
          'content_type', 'text/csv',
          'byte_length', 128,
          'sha256', repeat('5', 64)
        )
      )
    );
    RAISE EXCEPTION 'runtime cross-owner upload function was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'runtime cross-owner upload function was accepted' THEN
        RAISE;
      END IF;
  END;
END
$runtime_isolation$;

RESET SESSION AUTHORIZATION;

ROLLBACK;

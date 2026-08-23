BEGIN;

SET LOCAL app.owner_id = '44000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '44000000-0000-4000-8000-000000000001',
  'synthetic_import_rollback_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES
  (
    '44000000-0000-4000-8000-000000000101',
    '44000000-0000-4000-8000-000000000001',
    'current_arena', 'synthetic-arena-prior.csv', repeat('1', 64),
    'utf_8', 'current-arena/v1', 'accepted',
    '2026-08-23T00:00:00Z', '2026-08-23T00:01:00Z',
    0, 0, 0, 0
  ),
  (
    '44000000-0000-4000-8000-000000000102',
    '44000000-0000-4000-8000-000000000001',
    'current_arena', 'synthetic-arena-active.csv', repeat('2', 64),
    'utf_8', 'current-arena/v1', 'accepted',
    '2026-08-23T00:02:00Z', '2026-08-23T00:03:00Z',
    0, 0, 0, 0
  ),
  (
    '44000000-0000-4000-8000-000000000103',
    '44000000-0000-4000-8000-000000000001',
    'core_details', 'synthetic-core-only.csv', repeat('3', 64),
    'utf_8', 'core-details/v1', 'accepted',
    '2026-08-23T00:04:00Z', '2026-08-23T00:05:00Z',
    0, 0, 0, 0
  );

INSERT INTO dna.dataset_stream (owner_id, source_type)
VALUES
  ('44000000-0000-4000-8000-000000000001', 'current_arena'),
  ('44000000-0000-4000-8000-000000000001', 'core_details');

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
)
VALUES
  (
    '44000000-0000-4000-8000-000000000201',
    '44000000-0000-4000-8000-000000000001',
    'current_arena', 1,
    '44000000-0000-4000-8000-000000000101',
    '2026-08-23T00:01:30Z', '2026-08-23T00:01:00Z',
    '2026-08-23T00:01:45Z', false
  ),
  (
    '44000000-0000-4000-8000-000000000202',
    '44000000-0000-4000-8000-000000000001',
    'current_arena', 2,
    '44000000-0000-4000-8000-000000000102',
    '2026-08-23T00:03:30Z', '2026-08-23T00:03:00Z',
    '2026-08-23T00:03:45Z', true
  ),
  (
    '44000000-0000-4000-8000-000000000203',
    '44000000-0000-4000-8000-000000000001',
    'core_details', 1,
    '44000000-0000-4000-8000-000000000103',
    '2026-08-23T00:05:30Z', '2026-08-23T00:05:00Z',
    '2026-08-23T00:05:45Z', true
  );

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at, completed_at,
  affected_record_count
)
VALUES
  (
    '44000000-0000-4000-8000-000000000301',
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000201',
    'completed', '2026-08-23T00:01:35Z', '2026-08-23T00:01:45Z', 0
  ),
  (
    '44000000-0000-4000-8000-000000000302',
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000202',
    'completed', '2026-08-23T00:03:35Z', '2026-08-23T00:03:45Z', 0
  ),
  (
    '44000000-0000-4000-8000-000000000303',
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000203',
    'completed', '2026-08-23T00:05:35Z', '2026-08-23T00:05:45Z', 0
  );

DO $rollback_assertions$
DECLARE
  v_missing record;
  v_no_prior record;
  v_created record;
  v_existing record;
  v_inactive record;
BEGIN
  SELECT * INTO STRICT v_missing
  FROM dna.rollback_active_source_version(
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000199',
    'Synthetic missing rollback remains unchanged.',
    'synthetic-missing-rollback',
    '2026-08-23T00:06:00Z'
  );
  IF v_missing.status <> 'not_found' THEN
    RAISE EXCEPTION 'missing rollback status is invalid';
  END IF;

  SELECT * INTO STRICT v_no_prior
  FROM dna.rollback_active_source_version(
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000103',
    'Synthetic no-prior rollback remains unchanged.',
    'synthetic-no-prior-rollback',
    '2026-08-23T00:06:00Z'
  );
  IF v_no_prior.status <> 'no_prior_version' THEN
    RAISE EXCEPTION 'no-prior rollback status is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dna.dataset_version
    WHERE id = '44000000-0000-4000-8000-000000000203'
      AND is_active AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'no-prior rollback mutated the active version';
  END IF;

  SELECT * INTO STRICT v_created
  FROM dna.rollback_active_source_version(
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000102',
    'Restore the prior synthetic Arena snapshot.',
    'synthetic-arena-rollback',
    '2026-08-23T00:06:00Z'
  );
  IF v_created.status <> 'restored'
     OR v_created.disposition <> 'created'
     OR v_created.source_type <> 'current_arena'
     OR v_created.restored_batch_id <>
       '44000000-0000-4000-8000-000000000101'::uuid
     OR v_created.rollback_id IS NULL
     OR v_created.aggregate_refresh_id IS NULL THEN
    RAISE EXCEPTION 'created rollback evidence is invalid';
  END IF;

  SELECT * INTO STRICT v_existing
  FROM dna.rollback_active_source_version(
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000102',
    'Restore the prior synthetic Arena snapshot.',
    'synthetic-arena-rollback',
    '2026-08-23T00:07:00Z'
  );
  IF v_existing.status <> 'restored'
     OR v_existing.disposition <> 'existing'
     OR v_existing.rollback_id <> v_created.rollback_id
     OR v_existing.aggregate_refresh_id <> v_created.aggregate_refresh_id THEN
    RAISE EXCEPTION 'rollback replay is not idempotent';
  END IF;

  SELECT * INTO STRICT v_inactive
  FROM dna.rollback_active_source_version(
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000102',
    'A different request sees an inactive version.',
    'synthetic-inactive-rollback',
    '2026-08-23T00:07:00Z'
  );
  IF v_inactive.status <> 'not_active' THEN
    RAISE EXCEPTION 'inactive rollback status is invalid';
  END IF;
END
$rollback_assertions$;

DO $rollback_state$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM dna.dataset_version
    WHERE id = '44000000-0000-4000-8000-000000000201'
      AND is_active AND rolled_back_at IS NULL
      AND aggregate_refreshed_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.dataset_version
    WHERE id = '44000000-0000-4000-8000-000000000202'
      AND NOT is_active
      AND rolled_back_at = '2026-08-23T00:06:00Z'
  ) THEN
    RAISE EXCEPTION 'dataset rollback state transition is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.import_batch
    WHERE id = '44000000-0000-4000-8000-000000000102'
      AND status = 'rolled_back'
      AND rollback_reason = 'Restore the prior synthetic Arena snapshot.'
  ) THEN
    RAISE EXCEPTION 'rolled-back batch provenance is invalid';
  END IF;

  IF (
    SELECT count(*) FROM dna.aggregate_refresh_job
    WHERE owner_id = '44000000-0000-4000-8000-000000000001'
      AND dataset_version_id = '44000000-0000-4000-8000-000000000201'
      AND status = 'queued'
  ) <> 1 THEN
    RAISE EXCEPTION 'restored version aggregate refresh was not queued once';
  END IF;

  IF (
    SELECT count(*) FROM dna.import_dataset_rollback
    WHERE owner_id = '44000000-0000-4000-8000-000000000001'
      AND source_type = 'current_arena'
  ) <> 1 THEN
    RAISE EXCEPTION 'rollback audit receipt is not singular';
  END IF;

  IF NOT has_table_privilege(
    'dna_app_runtime', 'dna.import_dataset_rollback', 'SELECT'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.rollback_active_source_version(uuid,uuid,text,text,timestamp with time zone)',
    'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) privilege
    WHERE relation.oid = 'dna.import_dataset_rollback'::regclass
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'SELECT'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) privilege
    WHERE routine.oid =
      'dna.rollback_active_source_version(uuid,uuid,text,text,timestamp with time zone)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'rollback runtime privileges are unsafe';
  END IF;
END
$rollback_state$;

ROLLBACK;

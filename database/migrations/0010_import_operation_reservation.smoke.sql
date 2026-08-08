BEGIN;

DO $runtime_role_assertions$
DECLARE
  runtime_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT *
  INTO STRICT runtime_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'dna_app_runtime';

  IF
    NOT runtime_role.rolcanlogin
    OR runtime_role.rolsuper
    OR runtime_role.rolcreatedb
    OR runtime_role.rolcreaterole
    OR runtime_role.rolinherit
    OR runtime_role.rolreplication
    OR runtime_role.rolbypassrls
    OR COALESCE(
      pg_has_role(
        'dna_app_runtime',
        (
          SELECT role.oid
          FROM pg_catalog.pg_roles role
          WHERE role.rolname = 'neon_superuser'
        ),
        'MEMBER'
      ),
      false
    )
  THEN
    RAISE EXCEPTION 'runtime role is not least privileged';
  END IF;

  IF
    NOT has_schema_privilege('dna_app_runtime', 'dna', 'USAGE')
    OR NOT has_table_privilege(
      'dna_app_runtime',
      'dna.app_owner',
      'SELECT'
    )
    OR has_table_privilege(
      'dna_app_runtime',
      'dna.app_owner',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR NOT has_table_privilege(
      'dna_app_runtime',
      'dna.import_operation_reservation',
      'SELECT'
    )
    OR NOT has_table_privilege(
      'dna_app_runtime',
      'dna.import_operation_reservation',
      'INSERT'
    )
    OR has_table_privilege(
      'dna_app_runtime',
      'dna.import_operation_reservation',
      'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  THEN
    RAISE EXCEPTION 'runtime role grants are not minimal';
  END IF;
END
$runtime_role_assertions$;

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'synthetic-owner-1'
);

SELECT set_config(
  'app.owner_id',
  '22222222-2222-4222-8222-222222222222',
  true
);

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'synthetic-owner-2'
);

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

DO $smoke$
DECLARE
  v_created record;
  v_replayed record;
  v_conflict record;
BEGIN
  SELECT *
  INTO v_created
  FROM dna.reserve_import_operation(
    '11111111-1111-4111-8111-111111111111',
    'upload_batch',
    'synthetic-request-1',
    repeat('a', 64)::character(64),
    '2026-07-26T00:00:00.000Z'
  );

  IF v_created.disposition <> 'created' THEN
    RAISE EXCEPTION 'first reservation was not created';
  END IF;

  SELECT *
  INTO v_replayed
  FROM dna.reserve_import_operation(
    '11111111-1111-4111-8111-111111111111',
    'upload_batch',
    'synthetic-request-1',
    repeat('a', 64)::character(64),
    '2026-07-26T00:01:00.000Z'
  );

  IF
    v_replayed.disposition <> 'existing'
    OR v_replayed.operation_id <> v_created.operation_id
    OR v_replayed.request_fingerprint_sha256 <>
      v_created.request_fingerprint_sha256
  THEN
    RAISE EXCEPTION 'exact replay did not reuse durable reservation';
  END IF;

  SELECT *
  INTO v_conflict
  FROM dna.reserve_import_operation(
    '11111111-1111-4111-8111-111111111111',
    'upload_batch',
    'synthetic-request-1',
    repeat('b', 64)::character(64),
    '2026-07-26T00:02:00.000Z'
  );

  IF
    v_conflict.disposition <> 'existing'
    OR v_conflict.request_fingerprint_sha256 <>
      repeat('a', 64)::character(64)
  THEN
    RAISE EXCEPTION 'conflicting replay did not preserve accepted evidence';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.reserve_import_operation(
      '22222222-2222-4222-8222-222222222222',
      'upload_batch',
      'cross-owner-request',
      repeat('c', 64)::character(64),
      '2026-07-26T00:03:00.000Z'
    );
    RAISE EXCEPTION 'cross-owner reservation was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'cross-owner reservation was accepted' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config(
    'app.owner_id',
    '22222222-2222-4222-8222-222222222222',
    true
  );

  PERFORM *
  FROM dna.reserve_import_operation(
    '22222222-2222-4222-8222-222222222222',
    'upload_batch',
    'synthetic-owner-2-request',
    repeat('e', 64)::character(64),
    '2026-07-26T00:03:30.000Z'
  );

  PERFORM set_config(
    'app.owner_id',
    '11111111-1111-4111-8111-111111111111',
    true
  );

  IF (
    SELECT count(*)
    FROM dna.import_operation_reservation
  ) <> 2 THEN
    RAISE EXCEPTION 'owner-scoped reservation count is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    WHERE
      relation.oid = 'dna.import_operation_reservation'::regclass
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'operation reservation must enable and force RLS';
  END IF;
END
$smoke$;

SET LOCAL SESSION AUTHORIZATION dna_app_runtime;

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

DO $runtime_isolation$
DECLARE
  v_replayed record;
BEGIN
  IF
    session_user <> 'dna_app_runtime'
    OR current_user <> 'dna_app_runtime'
  THEN
    RAISE EXCEPTION 'runtime session identity is substituted';
  END IF;

  IF (
    SELECT count(*) FROM dna.app_owner
  ) <> 1 THEN
    RAISE EXCEPTION 'runtime owner lookup crossed the owner boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.app_owner
    WHERE id = '22222222-2222-4222-8222-222222222222'
  ) THEN
    RAISE EXCEPTION 'runtime direct SELECT exposed another owner';
  END IF;

  IF (
    SELECT count(*) FROM dna.import_operation_reservation
  ) <> 1 THEN
    RAISE EXCEPTION 'runtime reservation SELECT crossed the owner boundary';
  END IF;

  SELECT *
  INTO v_replayed
  FROM dna.reserve_import_operation(
    '11111111-1111-4111-8111-111111111111',
    'upload_batch',
    'synthetic-request-1',
    repeat('a', 64)::character(64),
    '2026-07-26T00:04:00.000Z'
  );

  IF v_replayed.disposition <> 'existing' THEN
    RAISE EXCEPTION 'runtime exact replay did not remain idempotent';
  END IF;

  BEGIN
    INSERT INTO dna.import_operation_reservation (
      id,
      owner_id,
      operation_kind,
      idempotency_key,
      request_fingerprint_sha256,
      requested_at
    )
    VALUES (
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
      'upload_batch',
      'cross-owner-direct-insert',
      repeat('c', 64)::character(64),
      '2026-07-26T00:05:00.000Z'
    );
    RAISE EXCEPTION 'runtime direct cross-owner INSERT was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM dna.reserve_import_operation(
      '22222222-2222-4222-8222-222222222222',
      'upload_batch',
      'cross-owner-runtime-function',
      repeat('d', 64)::character(64),
      '2026-07-26T00:06:00.000Z'
    );
    RAISE EXCEPTION 'runtime cross-owner function call was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'runtime cross-owner function call was accepted' THEN
        RAISE;
      END IF;
  END;
END
$runtime_isolation$;

RESET SESSION AUTHORIZATION;

ROLLBACK;

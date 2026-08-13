\set ON_ERROR_STOP on

BEGIN;

DO $runtime_identity$
DECLARE
  runtime_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  IF session_user <> 'dna_app_runtime' OR current_user <> 'dna_app_runtime' THEN
    RAISE EXCEPTION 'runtime preflight requires a direct dna_app_runtime login';
  END IF;

  SELECT *
  INTO STRICT runtime_role
  FROM pg_catalog.pg_roles
  WHERE rolname = session_user;

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
        session_user,
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
    RAISE EXCEPTION 'runtime preflight detected privileged role evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE
      namespace.nspname = 'dna'
      AND relation.relkind IN ('r', 'p')
      AND (
        NOT relation.relrowsecurity
        OR NOT relation.relforcerowsecurity
        OR NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy policy
          WHERE policy.polrelid = relation.oid
        )
      )
  ) THEN
    RAISE EXCEPTION 'runtime preflight requires forced RLS and a policy on every DNA table';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges privilege
    WHERE
      privilege.table_schema = 'dna'
      AND privilege.grantee = 'PUBLIC'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges privilege
    WHERE
      privilege.specific_schema = 'dna'
      AND privilege.grantee = 'PUBLIC'
  ) THEN
    RAISE EXCEPTION 'runtime preflight detected PUBLIC DNA privileges';
  END IF;
END
$runtime_identity$;

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

DO $owner_isolation$
DECLARE
  replayed record;
BEGIN
  IF (
    SELECT count(*)
    FROM dna.app_owner
  ) <> 1 THEN
    RAISE EXCEPTION 'runtime preflight owner lookup crossed the owner boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.app_owner
    WHERE id = '22222222-2222-4222-8222-222222222222'
  ) THEN
    RAISE EXCEPTION 'runtime preflight exposed another owner';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.import_operation_reservation
  ) <> 1 THEN
    RAISE EXCEPTION 'runtime preflight reservation lookup crossed the owner boundary';
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
      'direct-login-cross-owner-insert',
      repeat('c', 64)::character(64),
      '2026-08-13T00:00:00.000Z'
    );
    RAISE EXCEPTION 'runtime preflight accepted a direct cross-owner INSERT';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM dna.reserve_import_operation(
      '22222222-2222-4222-8222-222222222222',
      'upload_batch',
      'direct-login-cross-owner-function',
      repeat('d', 64)::character(64),
      '2026-08-13T00:01:00.000Z'
    );
    RAISE EXCEPTION 'runtime preflight accepted a cross-owner function call';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'runtime preflight accepted a cross-owner function call' THEN
        RAISE;
      END IF;
  END;

  SELECT *
  INTO replayed
  FROM dna.reserve_import_operation(
    '11111111-1111-4111-8111-111111111111',
    'upload_batch',
    'direct-login-owner-replay',
    repeat('e', 64)::character(64),
    '2026-08-13T00:02:00.000Z'
  );

  IF replayed.disposition <> 'created' THEN
    RAISE EXCEPTION 'runtime preflight could not use the approved owner function';
  END IF;
END
$owner_isolation$;

ROLLBACK;

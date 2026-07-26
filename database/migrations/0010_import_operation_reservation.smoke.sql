BEGIN;

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

  IF (
    SELECT count(*)
    FROM dna.import_operation_reservation
  ) <> 1 THEN
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

ROLLBACK;

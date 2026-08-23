BEGIN;

SET LOCAL app.owner_id = '45000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '45000000-0000-4000-8000-000000000001',
  'synthetic_evidence_object_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-race-merge.csv', repeat('1', 64),
  'utf_8', 'race-merge/v1', 'validating',
  '2026-08-23T07:00:00Z', 1000, 0, 0, 0
);

DO $registration_assertions$
DECLARE
  v_created record;
  v_existing record;
  v_conflict_blocked boolean := false;
  v_wrong_owner_blocked boolean := false;
BEGIN
  SELECT * INTO STRICT v_created
  FROM dna.register_dataset_evidence_object(
    '45000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000101',
    'race_merge', 'staged_rows', 0, 'parquet',
    'owners/45000000-0000-4000-8000-000000000001/evidence/part-0000.parquet',
    repeat('2', 64), 65536, 1000, 'event-0001', 'event-1000',
    '2026-08-23T07:01:00Z'
  );

  IF v_created.status <> 'created' OR v_created.evidence_object_id IS NULL THEN
    RAISE EXCEPTION 'evidence object was not registered';
  END IF;

  SELECT * INTO STRICT v_existing
  FROM dna.register_dataset_evidence_object(
    '45000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000101',
    'race_merge', 'staged_rows', 0, 'parquet',
    'owners/45000000-0000-4000-8000-000000000001/evidence/part-0000.parquet',
    repeat('2', 64), 65536, 1000, 'event-0001', 'event-1000',
    '2026-08-23T07:02:00Z'
  );

  IF v_existing.status <> 'existing'
     OR v_existing.evidence_object_id <> v_created.evidence_object_id THEN
    RAISE EXCEPTION 'evidence object replay is not idempotent';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.register_dataset_evidence_object(
      '45000000-0000-4000-8000-000000000001',
      '45000000-0000-4000-8000-000000000101',
      'race_merge', 'staged_rows', 0, 'parquet',
      'owners/45000000-0000-4000-8000-000000000001/evidence/part-0000.parquet',
      repeat('3', 64), 65536, 1000, 'event-0001', 'event-1000',
      '2026-08-23T07:02:00Z'
    );
  EXCEPTION WHEN OTHERS THEN
    v_conflict_blocked := SQLERRM = 'evidence object registration conflict';
  END;

  BEGIN
    PERFORM *
    FROM dna.register_dataset_evidence_object(
      '45000000-0000-4000-8000-000000000999',
      '45000000-0000-4000-8000-000000000101',
      'race_merge', 'staged_rows', 1, 'parquet',
      'owners/wrong/evidence/part-0001.parquet',
      repeat('4', 64), 65536, 1000, NULL, NULL,
      '2026-08-23T07:02:00Z'
    );
  EXCEPTION WHEN OTHERS THEN
    v_wrong_owner_blocked :=
      SQLERRM = 'owner-scoped evidence object registration denied';
  END;

  IF NOT v_conflict_blocked OR NOT v_wrong_owner_blocked THEN
    RAISE EXCEPTION 'evidence object registration did not fail closed';
  END IF;
END
$registration_assertions$;

DO $security_assertions$
BEGIN
  IF (
    SELECT count(*) FROM dna.dataset_evidence_object
    WHERE owner_id = '45000000-0000-4000-8000-000000000001'
  ) <> 1
  OR NOT has_table_privilege(
    'dna_app_runtime', 'dna.dataset_evidence_object', 'SELECT'
  )
  OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.register_dataset_evidence_object(uuid,uuid,text,text,integer,text,text,character,bigint,bigint,text,text,timestamp with time zone)',
    'EXECUTE'
  )
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) privilege
    WHERE relation.oid = 'dna.dataset_evidence_object'::regclass
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'SELECT'
  )
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) privilege
    WHERE routine.oid =
      'dna.register_dataset_evidence_object(uuid,uuid,text,text,integer,text,text,character,bigint,bigint,text,text,timestamp with time zone)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'dataset evidence object security boundary is unsafe';
  END IF;
END
$security_assertions$;

ROLLBACK;

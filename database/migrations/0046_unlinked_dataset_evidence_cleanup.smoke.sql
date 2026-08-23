BEGIN;

SET LOCAL app.owner_id = '46000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '46000000-0000-4000-8000-000000000001',
  'synthetic_evidence_cleanup_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '46000000-0000-4000-8000-000000000101',
  '46000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-evidence-cleanup.csv', repeat('1', 64),
  'utf_8', 'race-merge/v1', 'validating',
  '2026-08-23T08:00:00Z', 1, 0, 1, 0
);

SELECT *
FROM dna.register_dataset_evidence_object(
  '46000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000101',
  'race_merge', 'normalized_partition', 0, 'ndjson_gzip',
  'evidence/synthetic/cleanup/part-0000.ndjson.gz',
  repeat('2', 64), 83, 1, 'synthetic-event:synthetic-core',
  'synthetic-event:synthetic-core', '2026-08-23T08:01:00Z'
);

DO $cleanup_assertions$
DECLARE
  v_cleaned record;
  v_replay record;
  v_wrong_owner_blocked boolean := false;
  v_checksum_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM *
    FROM dna.cleanup_unlinked_dataset_evidence_batch(
      '46000000-0000-4000-8000-000000000999',
      '46000000-0000-4000-8000-000000000101',
      repeat('1', 64)
    );
  EXCEPTION WHEN OTHERS THEN
    v_wrong_owner_blocked :=
      SQLERRM = 'owner-scoped evidence batch cleanup denied';
  END;

  BEGIN
    PERFORM *
    FROM dna.cleanup_unlinked_dataset_evidence_batch(
      '46000000-0000-4000-8000-000000000001',
      '46000000-0000-4000-8000-000000000101',
      repeat('9', 64)
    );
  EXCEPTION WHEN OTHERS THEN
    v_checksum_blocked :=
      SQLERRM = 'evidence batch cleanup checksum conflict';
  END;

  IF NOT v_wrong_owner_blocked OR NOT v_checksum_blocked THEN
    RAISE EXCEPTION 'evidence batch cleanup did not fail closed';
  END IF;

  SELECT * INTO STRICT v_cleaned
  FROM dna.cleanup_unlinked_dataset_evidence_batch(
    '46000000-0000-4000-8000-000000000001',
    '46000000-0000-4000-8000-000000000101',
    repeat('1', 64)
  );

  IF v_cleaned.status <> 'cleaned'
     OR v_cleaned.deleted_manifest_count <> 1 THEN
    RAISE EXCEPTION 'evidence batch cleanup result is invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.import_batch
    WHERE owner_id = '46000000-0000-4000-8000-000000000001'
      AND id = '46000000-0000-4000-8000-000000000101'
  ) OR EXISTS (
    SELECT 1 FROM dna.dataset_evidence_object
    WHERE owner_id = '46000000-0000-4000-8000-000000000001'
      AND import_batch_id = '46000000-0000-4000-8000-000000000101'
  ) THEN
    RAISE EXCEPTION 'evidence batch cleanup left relational residue';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.cleanup_unlinked_dataset_evidence_batch(
    '46000000-0000-4000-8000-000000000001',
    '46000000-0000-4000-8000-000000000101',
    repeat('1', 64)
  );

  IF v_replay.status <> 'not_found'
     OR v_replay.deleted_manifest_count <> 0 THEN
    RAISE EXCEPTION 'evidence batch cleanup replay is invalid';
  END IF;
END
$cleanup_assertions$;

DO $security_assertions$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.cleanup_unlinked_dataset_evidence_batch(uuid,uuid,character)',
    'EXECUTE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dataset_evidence_object', 'DELETE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) privilege
    WHERE routine.oid =
      'dna.cleanup_unlinked_dataset_evidence_batch(uuid,uuid,character)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'evidence batch cleanup security boundary is unsafe';
  END IF;
END
$security_assertions$;

ROLLBACK;

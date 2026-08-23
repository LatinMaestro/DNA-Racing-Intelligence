BEGIN;

SET LOCAL app.owner_id = '44000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '44000000-0000-4000-8000-000000000001',
  'synthetic_normalized_artifact_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '44000000-0000-4000-8000-000000000101',
  '44000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-normalized-artifact.csv', repeat('1', 64),
  'utf_8', 'race-merge/v1', 'validating',
  '2026-08-23T00:00:00Z', 2, 0, 0, 0
);

DO $normalized_artifact_register$
DECLARE
  v_created record;
  v_replay record;
BEGIN
  SELECT * INTO STRICT v_created
  FROM dna.register_normalized_analytical_artifact(
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000101',
    'race_merge',
    'normalized/owner/44000000/batch/101/part-000.parquet',
    repeat('2', 64),
    4096,
    2,
    2,
    0,
    0,
    repeat('3', 64),
    '2026-08-20T00:00:00Z',
    '2026-08-21T00:00:00Z',
    '2026-08-23T00:01:00Z'
  );

  IF v_created.disposition <> 'created'
     OR v_created.artifact_state <> 'prepared' THEN
    RAISE EXCEPTION 'normalized artifact was not registered as prepared';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.register_normalized_analytical_artifact(
    '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000101',
    'race_merge',
    'normalized/owner/44000000/batch/101/part-000.parquet',
    repeat('2', 64),
    4096,
    2,
    2,
    0,
    0,
    repeat('3', 64),
    '2026-08-20T00:00:00Z',
    '2026-08-21T00:00:00Z',
    '2026-08-23T00:01:00Z'
  );

  IF v_replay.disposition <> 'existing'
     OR v_replay.artifact_id <> v_created.artifact_id THEN
    RAISE EXCEPTION 'normalized artifact replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.register_normalized_analytical_artifact(
      '44000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000101',
      'race_merge',
      'normalized/owner/44000000/batch/101/part-000.parquet',
      repeat('4', 64),
      4096,
      2,
      2,
      0,
      0,
      repeat('3', 64),
      '2026-08-20T00:00:00Z',
      '2026-08-21T00:00:00Z',
      '2026-08-23T00:01:00Z'
    );
    RAISE EXCEPTION 'normalized artifact conflict was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'normalized artifact idempotency conflict' THEN
        RAISE;
      END IF;
  END;
END
$normalized_artifact_register$;

UPDATE dna.import_batch
SET status = 'accepted',
    import_completed_at = '2026-08-23T00:02:00Z',
    accepted_rows = 2
WHERE owner_id = '44000000-0000-4000-8000-000000000001'
  AND id = '44000000-0000-4000-8000-000000000101';

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
)
VALUES (
  '44000000-0000-4000-8000-000000000201',
  '44000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '44000000-0000-4000-8000-000000000101',
  '2026-08-23T00:03:00Z', '2026-08-21T00:00:00Z', true
);

SELECT dna.bind_normalized_analytical_artifact(
  '44000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000101',
  '44000000-0000-4000-8000-000000000201',
  '2026-08-23T00:03:00Z'
);

SELECT dna.bind_normalized_analytical_artifact(
  '44000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000101',
  '44000000-0000-4000-8000-000000000201',
  '2026-08-23T00:04:00Z'
);

DO $normalized_artifact_bound$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.normalized_analytical_artifact artifact
    WHERE artifact.owner_id = '44000000-0000-4000-8000-000000000001'
      AND artifact.import_batch_id = '44000000-0000-4000-8000-000000000101'
      AND artifact.dataset_version_id = '44000000-0000-4000-8000-000000000201'
      AND artifact.state = 'bound'
      AND artifact.source_row_count = 2
      AND artifact.ready_row_count = 2
      AND artifact.quarantined_row_count = 0
      AND artifact.artifact_format = 'parquet/v1'
      AND artifact.storage_provider = 'cloudflare_r2'
  ) THEN
    RAISE EXCEPTION 'normalized artifact binding evidence is incomplete';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.normalized_analytical_artifact
    WHERE owner_id = '44000000-0000-4000-8000-000000000001'
  ) <> 1 THEN
    RAISE EXCEPTION 'normalized artifact manifest is not compact per import batch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'dna.normalized_analytical_artifact'::regclass
      AND relrowsecurity
      AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'normalized artifact manifest is not protected by forced RLS';
  END IF;
END
$normalized_artifact_bound$;

SELECT dna.rollback_normalized_analytical_artifact(
  '44000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000201',
  '2026-08-23T00:05:00Z'
);

SELECT dna.rollback_normalized_analytical_artifact(
  '44000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000201',
  '2026-08-23T00:06:00Z'
);

DO $normalized_artifact_rollback$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.normalized_analytical_artifact artifact
    WHERE artifact.owner_id = '44000000-0000-4000-8000-000000000001'
      AND artifact.dataset_version_id = '44000000-0000-4000-8000-000000000201'
      AND artifact.state = 'rolled_back'
      AND artifact.rolled_back_at = '2026-08-23T00:05:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'normalized artifact rollback was not deterministic';
  END IF;
END
$normalized_artifact_rollback$;

BEGIN;
  SET LOCAL app.owner_id = '44000000-0000-4000-8000-000000000002';
  BEGIN
    PERFORM * FROM dna.register_normalized_analytical_artifact(
      '44000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000101',
      'race_merge',
      'normalized/owner/44000000/batch/101/part-000.parquet',
      repeat('2', 64),
      4096,
      2,
      2,
      0,
      0,
      repeat('3', 64),
      '2026-08-20T00:00:00Z',
      '2026-08-21T00:00:00Z',
      '2026-08-23T00:01:00Z'
    );
    RAISE EXCEPTION 'cross-owner normalized artifact registration was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'owner-scoped normalized artifact registration denied' THEN
        RAISE;
      END IF;
  END;
ROLLBACK;

ROLLBACK;

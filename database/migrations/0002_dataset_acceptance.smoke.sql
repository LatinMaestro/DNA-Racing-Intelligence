BEGIN;

SET LOCAL app.owner_id = '10000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'synthetic_acceptance_owner'
);

INSERT INTO dna.import_batch (
  id,
  owner_id,
  source_type,
  source_filename,
  checksum_sha256,
  detected_encoding,
  schema_version,
  status,
  uploaded_at,
  minimum_accepted_event_at,
  maximum_accepted_event_at,
  source_rows,
  accepted_rows,
  rejected_rows,
  warning_rows
)
VALUES
  (
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-race-1.csv',
    repeat('a', 64),
    'utf_8',
    'race-merge/v1',
    'validating',
    '2026-07-23T00:00:00Z',
    '2026-07-22T22:00:00Z',
    '2026-07-22T23:00:00Z',
    3,
    0,
    3,
    0
  ),
  (
    '10000000-0000-4000-8000-000000000102',
    '10000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-race-2.csv',
    repeat('b', 64),
    'utf_8',
    'race-merge/v1',
    'validating',
    '2026-07-23T01:00:00Z',
    '2026-07-22T23:00:00Z',
    '2026-07-23T00:00:00Z',
    2,
    0,
    2,
    0
  ),
  (
    '10000000-0000-4000-8000-000000000103',
    '10000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-race-stale.csv',
    repeat('c', 64),
    'utf_8',
    'race-merge/v1',
    'validating',
    '2026-07-23T02:00:00Z',
    '2026-07-22T21:00:00Z',
    '2026-07-22T22:00:00Z',
    1,
    0,
    1,
    0
  ),
  (
    '10000000-0000-4000-8000-000000000104',
    '10000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-race-count-mismatch.csv',
    repeat('d', 64),
    'utf_8',
    'race-merge/v1',
    'validating',
    '2026-07-23T03:00:00Z',
    '2026-07-23T00:00:00Z',
    '2026-07-23T01:00:00Z',
    2,
    0,
    2,
    0
  ),
  (
    '10000000-0000-4000-8000-000000000111',
    '10000000-0000-4000-8000-000000000001',
    'current_arena',
    'synthetic-arena-1.csv',
    repeat('e', 64),
    'utf_8',
    'current-arena/v1',
    'validating',
    '2026-07-23T00:00:00Z',
    NULL,
    NULL,
    2,
    0,
    2,
    0
  ),
  (
    '10000000-0000-4000-8000-000000000112',
    '10000000-0000-4000-8000-000000000001',
    'current_arena',
    'synthetic-arena-2.csv',
    repeat('f', 64),
    'utf_8',
    'current-arena/v1',
    'validating',
    '2026-07-23T01:00:00Z',
    NULL,
    NULL,
    1,
    0,
    1,
    0
  );

INSERT INTO dna.dataset_staged_record (
  owner_id,
  import_batch_id,
  source_row_number,
  natural_key,
  fingerprint_sha256,
  status
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000101',
    1,
    'synthetic-race-entry-1',
    repeat('1', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000101',
    2,
    'synthetic-race-entry-2',
    repeat('2', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000101',
    3,
    'synthetic-race-entry-2',
    repeat('2', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000102',
    1,
    'synthetic-race-entry-1',
    repeat('9', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000102',
    2,
    'synthetic-race-entry-3',
    repeat('3', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000103',
    1,
    'synthetic-stale-entry',
    repeat('4', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000104',
    1,
    'synthetic-count-entry',
    repeat('5', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000111',
    1,
    'synthetic-listing-1',
    repeat('6', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000111',
    2,
    'synthetic-listing-2',
    repeat('7', 64),
    'ready'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000112',
    1,
    'synthetic-listing-1',
    repeat('8', 64),
    'ready'
  );

SELECT *
FROM dna.accept_staged_dataset(
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000201',
  '2026-07-23T00:02:00Z',
  '2026-07-23T00:03:00Z',
  '2026-07-22T23:00:00Z'
);

SELECT *
FROM dna.accept_staged_dataset(
  '10000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000202',
  '2026-07-23T01:02:00Z',
  '2026-07-23T01:03:00Z',
  '2026-07-23T00:00:00Z'
);

SELECT *
FROM dna.accept_staged_dataset(
  '10000000-0000-4000-8000-000000000102',
  '10000000-0000-4000-8000-000000000299',
  '2026-07-23T01:02:00Z',
  '2026-07-23T01:03:00Z',
  '2026-07-23T00:00:00Z'
);

SELECT *
FROM dna.accept_staged_dataset(
  '10000000-0000-4000-8000-000000000103',
  '10000000-0000-4000-8000-000000000203',
  '2026-07-23T02:02:00Z',
  '2026-07-23T02:03:00Z',
  '2026-07-22T22:00:00Z'
);

DO $failure_rollback$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.accept_staged_dataset(
      '10000000-0000-4000-8000-000000000104',
      '10000000-0000-4000-8000-000000000204',
      '2026-07-23T03:02:00Z',
      '2026-07-23T03:03:00Z',
      '2026-07-23T01:00:00Z'
    );
    RAISE EXCEPTION 'expected staged-count failure was not raised';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'staged row count does not match%' THEN
        RAISE;
      END IF;
  END;
END
$failure_rollback$;

SELECT *
FROM dna.accept_staged_dataset(
  '10000000-0000-4000-8000-000000000111',
  '10000000-0000-4000-8000-000000000211',
  '2026-07-23T00:02:00Z',
  '2026-07-23T00:03:00Z',
  '2026-07-23T00:00:00Z'
);

SELECT *
FROM dna.accept_staged_dataset(
  '10000000-0000-4000-8000-000000000112',
  '10000000-0000-4000-8000-000000000212',
  '2026-07-23T01:02:00Z',
  '2026-07-23T01:03:00Z',
  '2026-07-23T01:00:00Z'
);

DO $acceptance_assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.dataset_version
    WHERE owner_id = '10000000-0000-4000-8000-000000000001'
      AND source_type = 'race_merge'
  ) <> 2 THEN
    RAISE EXCEPTION 'Idempotent replay created another race version';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '10000000-0000-4000-8000-000000000101'
      AND status = 'accepted'
      AND accepted_rows = 3
      AND rejected_rows = 0
  ) THEN
    RAISE EXCEPTION 'First cumulative batch counts were not accepted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '10000000-0000-4000-8000-000000000102'
      AND status = 'accepted'
      AND accepted_rows = 1
      AND rejected_rows = 1
      AND warning_rows = 1
  ) THEN
    RAISE EXCEPTION 'Cumulative conflict counts were not retained';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.dataset_version_record
    WHERE dataset_version_id = '10000000-0000-4000-8000-000000000202'
  ) <> 1 THEN
    RAISE EXCEPTION 'Cumulative version stored more than its new-record delta';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version_record version_record
    JOIN dna.dataset_version version_row
      ON version_row.owner_id = version_record.owner_id
      AND version_row.id = version_record.dataset_version_id
    WHERE
      version_record.source_type = 'race_merge'
      AND version_row.version_number <= 2
      AND version_row.rolled_back_at IS NULL
      AND version_record.natural_key = 'synthetic-race-entry-1'
      AND version_record.fingerprint_sha256 = repeat('1', 64)
  ) THEN
    RAISE EXCEPTION 'Conflict overwrote an accepted cumulative fact';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.dataset_version_record version_record
    JOIN dna.dataset_version version_row
      ON version_row.owner_id = version_record.owner_id
      AND version_row.id = version_record.dataset_version_id
    WHERE
      version_record.source_type = 'race_merge'
      AND version_row.version_number <= 2
      AND version_row.rolled_back_at IS NULL
  ) <> 3 THEN
    RAISE EXCEPTION 'Cumulative deltas do not resolve to the full active set';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '10000000-0000-4000-8000-000000000103'
      AND status = 'quarantined'
  ) OR EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE import_batch_id = '10000000-0000-4000-8000-000000000103'
  ) THEN
    RAISE EXCEPTION 'Stale batch activated a dataset version';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '10000000-0000-4000-8000-000000000104'
      AND status = 'validating'
  ) OR EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE import_batch_id = '10000000-0000-4000-8000-000000000104'
  ) THEN
    RAISE EXCEPTION 'Failed acceptance did not roll back atomically';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.dataset_version_record
    WHERE dataset_version_id = '10000000-0000-4000-8000-000000000211'
  ) <> 2 OR (
    SELECT count(*)
    FROM dna.dataset_version_record
    WHERE dataset_version_id = '10000000-0000-4000-8000-000000000212'
  ) <> 1 THEN
    RAISE EXCEPTION 'Arena snapshots were not versioned historically';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version_record
    WHERE
      dataset_version_id = '10000000-0000-4000-8000-000000000212'
      AND natural_key = 'synthetic-listing-1'
      AND fingerprint_sha256 = repeat('8', 64)
  ) THEN
    RAISE EXCEPTION 'Changed Arena snapshot fact was not accepted';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.aggregate_refresh_job
    WHERE status = 'queued'
  ) <> 4 THEN
    RAISE EXCEPTION 'Accepted versions must queue aggregate refresh separately';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE aggregate_refreshed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Acceptance fabricated aggregate completion';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc proc
    JOIN pg_namespace ns ON ns.oid = proc.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(proc.proacl, acldefault('f', proc.proowner))
    ) acl
    WHERE
      ns.nspname = 'dna'
      AND proc.proname = 'accept_staged_dataset'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Dataset acceptance function is executable by PUBLIC';
  END IF;
END
$acceptance_assertions$;

SELECT *
FROM dna.rollback_active_dataset(
  'current_arena',
  'synthetic snapshot rollback',
  '2026-07-23T01:10:00Z'
);

SELECT *
FROM dna.rollback_active_dataset(
  'race_merge',
  'synthetic cumulative rollback',
  '2026-07-23T01:10:00Z'
);

DO $rollback_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE
      id = '10000000-0000-4000-8000-000000000211'
      AND is_active
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE
      id = '10000000-0000-4000-8000-000000000212'
      AND NOT is_active
      AND rolled_back_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Arena rollback did not restore its prior snapshot';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE
      id = '10000000-0000-4000-8000-000000000201'
      AND is_active
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '10000000-0000-4000-8000-000000000102'
      AND status = 'rolled_back'
      AND rollback_reason = 'synthetic cumulative rollback'
  ) THEN
    RAISE EXCEPTION 'Cumulative rollback did not restore version and audit state';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.dataset_record_contribution
    WHERE import_batch_id = '10000000-0000-4000-8000-000000000102'
  ) <> 1 THEN
    RAISE EXCEPTION 'Rollback deleted accepted contribution provenance';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.dataset_version_record version_record
    JOIN dna.dataset_version version_row
      ON version_row.owner_id = version_record.owner_id
      AND version_row.id = version_record.dataset_version_id
    WHERE
      version_record.source_type = 'race_merge'
      AND version_row.rolled_back_at IS NULL
      AND version_row.version_number <= 1
  ) <> 2 THEN
    RAISE EXCEPTION 'Rollback did not restore the prior cumulative active set';
  END IF;
END
$rollback_assertions$;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  'synthetic_acceptance_other_owner'
);

INSERT INTO dna.dataset_stream (owner_id, source_type)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  'race_merge'
);

CREATE ROLE dna_ci_acceptance NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_acceptance;
GRANT SELECT ON dna.dataset_stream TO dna_ci_acceptance;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_acceptance;

SET LOCAL ROLE dna_ci_acceptance;
SET LOCAL app.owner_id = '10000000-0000-4000-8000-000000000001';

DO $rls_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.dataset_stream
    WHERE owner_id = '10000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Dataset stream RLS exposed another owner';
  END IF;
END
$rls_assertions$;

RESET ROLE;

ROLLBACK;

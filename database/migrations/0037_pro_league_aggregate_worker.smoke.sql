BEGIN;

SET LOCAL app.owner_id = '37000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '37000000-0000-4000-8000-000000000001',
  'synthetic_aggregate_worker_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '37000000-0000-4000-8000-000000000101',
  '37000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-worker.csv', repeat('7', 64),
  'utf_8', 'race-merge/v1', 'accepted',
  '2026-08-20T00:00:00Z', '2026-08-20T00:01:00Z',
  0, 0, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
)
VALUES (
  '37000000-0000-4000-8000-000000000201',
  '37000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '37000000-0000-4000-8000-000000000101',
  '2026-08-20T00:02:00Z', '2026-08-20T00:01:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
)
VALUES (
  '37000000-0000-4000-8000-000000000301',
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000201',
  'queued'
);

DO $aggregate_worker_assertions$
DECLARE
  v_claim record;
  v_prepared record;
  v_published record;
  v_replay record;
BEGIN
  SELECT * INTO STRICT v_claim
  FROM dna.claim_pro_league_aggregate_refresh(
    '37000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000301',
    'synthetic-worker',
    '2026-08-20T00:03:00Z',
    '2026-08-20T00:08:00Z'
  );
  IF v_claim.status <> 'claimed'
     OR v_claim.authenticated_owner_id <> 'synthetic_aggregate_worker_owner'
     OR v_claim.dataset_version_id <>
       '37000000-0000-4000-8000-000000000201'::uuid THEN
    RAISE EXCEPTION 'aggregate worker did not claim owner-scoped work';
  END IF;

  SELECT * INTO STRICT v_prepared
  FROM dna.prepare_pro_league_aggregate_refresh(
    '37000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000301',
    '37000000-0000-4000-8000-000000000201',
    v_claim.source_version_set_sha256
  );
  IF v_prepared.aggregate_family_count <> 4
     OR v_prepared.materialized_row_count <> 0 THEN
    RAISE EXCEPTION 'aggregate worker did not prepare the bounded four-family refresh';
  END IF;

  SELECT * INTO STRICT v_published
  FROM dna.publish_pro_league_aggregate_refresh(
    '37000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000301',
    '37000000-0000-4000-8000-000000000201',
    'synthetic-worker',
    v_prepared.prepared_aggregate_set_id,
    v_prepared.source_version_set_sha256,
    v_prepared.aggregate_family_count,
    v_prepared.materialized_row_count,
    '2026-08-20T00:04:00Z'
  );
  IF v_published.status <> 'published'
     OR v_published.aggregate_set_id <>
       '37000000-0000-4000-8000-000000000301'::uuid THEN
    RAISE EXCEPTION 'aggregate worker did not publish exact prepared evidence';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.claim_pro_league_aggregate_refresh(
    '37000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000301',
    'synthetic-worker-replay',
    '2026-08-20T00:05:00Z',
    '2026-08-20T00:10:00Z'
  );
  IF v_replay.status <> 'already_complete'
     OR v_replay.aggregate_set_id <>
       '37000000-0000-4000-8000-000000000301'::uuid THEN
    RAISE EXCEPTION 'aggregate worker replay was not idempotent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.aggregate_refresh_processing
    WHERE owner_id = '37000000-0000-4000-8000-000000000001'
      AND refresh_id = '37000000-0000-4000-8000-000000000301'
      AND state = 'published'
      AND source_version_set_sha256 = v_claim.source_version_set_sha256
  ) THEN
    RAISE EXCEPTION 'aggregate worker durable publication evidence is missing';
  END IF;
END
$aggregate_worker_assertions$;

CREATE ROLE dna_ci_aggregate_worker NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_aggregate_worker;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_aggregate_worker;
GRANT EXECUTE ON FUNCTION dna.claim_pro_league_aggregate_refresh(
  uuid, uuid, text, timestamptz, timestamptz
) TO dna_ci_aggregate_worker;

SET LOCAL ROLE dna_ci_aggregate_worker;
SET LOCAL app.owner_id = '37000000-0000-4000-8000-000000000001';

DO $aggregate_worker_privilege_assertions$
BEGIN
  BEGIN
    PERFORM * FROM dna.aggregate_refresh_processing;
    RAISE EXCEPTION 'worker received direct aggregate processing table access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$aggregate_worker_privilege_assertions$;

RESET ROLE;
ROLLBACK;

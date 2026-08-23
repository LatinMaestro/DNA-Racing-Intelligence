BEGIN;

SET LOCAL app.owner_id = '43000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '43000000-0000-4000-8000-000000000001',
  'synthetic_multi_source_aggregate_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES
  (
    '43000000-0000-4000-8000-000000000101',
    '43000000-0000-4000-8000-000000000001',
    'race_merge', 'synthetic-race.csv', repeat('1', 64),
    'utf_8', 'race-merge/v1', 'accepted',
    '2026-08-23T00:00:00Z', '2026-08-23T00:01:00Z',
    0, 0, 0, 0
  ),
  (
    '43000000-0000-4000-8000-000000000102',
    '43000000-0000-4000-8000-000000000001',
    'core_details', 'synthetic-core.csv', repeat('2', 64),
    'utf_8', 'core-details/v1', 'accepted',
    '2026-08-23T00:00:00Z', '2026-08-23T00:01:00Z',
    0, 0, 0, 0
  );

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
)
VALUES
  (
    '43000000-0000-4000-8000-000000000201',
    '43000000-0000-4000-8000-000000000001',
    'race_merge', 1,
    '43000000-0000-4000-8000-000000000101',
    '2026-08-23T00:02:00Z', '2026-08-23T00:01:00Z', true
  ),
  (
    '43000000-0000-4000-8000-000000000202',
    '43000000-0000-4000-8000-000000000001',
    'core_details', 1,
    '43000000-0000-4000-8000-000000000102',
    '2026-08-23T00:02:00Z', '2026-08-23T00:01:00Z', true
  );

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
)
VALUES
  (
    '43000000-0000-4000-8000-000000000301',
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000201',
    'queued'
  ),
  (
    '43000000-0000-4000-8000-000000000302',
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000202',
    'queued'
  );

DO $multi_source_aggregate_assertions$
DECLARE
  v_core_claim record;
  v_core_prepared record;
  v_core_published record;
  v_race_claim record;
  v_race_prepared record;
  v_race_published record;
BEGIN
  SELECT * INTO STRICT v_core_claim
  FROM dna.claim_pro_league_aggregate_refresh(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000302',
    'multi-source-core-worker',
    '2026-08-23T00:03:00Z',
    '2026-08-23T00:08:00Z'
  );

  IF v_core_claim.status <> 'claimed'
     OR v_core_claim.dataset_version_id <>
       '43000000-0000-4000-8000-000000000202'::uuid THEN
    RAISE EXCEPTION 'non-Race aggregate work was not claimed';
  END IF;

  SELECT * INTO STRICT v_core_prepared
  FROM dna.prepare_pro_league_aggregate_refresh(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000302',
    '43000000-0000-4000-8000-000000000202',
    v_core_claim.source_version_set_sha256
  );

  IF v_core_prepared.prepared_aggregate_set_id <>
       '43000000-0000-4000-8000-000000000302'::uuid
     OR v_core_prepared.aggregate_family_count <> 4
     OR v_core_prepared.materialized_row_count <> 0 THEN
    RAISE EXCEPTION 'non-Race aggregate preparation evidence is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.aggregate_refresh_job
    WHERE owner_id = '43000000-0000-4000-8000-000000000001'
      AND id = '43000000-0000-4000-8000-000000000301'
      AND status = 'queued'
      AND started_at IS NULL
      AND completed_at IS NULL
      AND affected_record_count IS NULL
  ) THEN
    RAISE EXCEPTION 'active Race Merge queue receipt was consumed indirectly';
  END IF;

  SELECT * INTO STRICT v_core_published
  FROM dna.publish_pro_league_aggregate_refresh(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000302',
    '43000000-0000-4000-8000-000000000202',
    'multi-source-core-worker',
    v_core_prepared.prepared_aggregate_set_id,
    v_core_prepared.source_version_set_sha256,
    v_core_prepared.aggregate_family_count,
    v_core_prepared.materialized_row_count,
    '2026-08-23T00:04:00Z'
  );

  IF v_core_published.status <> 'published'
     OR v_core_published.aggregate_set_id <>
       '43000000-0000-4000-8000-000000000302'::uuid THEN
    RAISE EXCEPTION 'non-Race aggregate publication failed';
  END IF;

  SELECT * INTO STRICT v_race_claim
  FROM dna.claim_pro_league_aggregate_refresh(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000301',
    'multi-source-race-worker',
    '2026-08-23T00:05:00Z',
    '2026-08-23T00:10:00Z'
  );

  IF v_race_claim.status <> 'claimed'
     OR v_race_claim.dataset_version_id <>
       '43000000-0000-4000-8000-000000000201'::uuid THEN
    RAISE EXCEPTION 'active Race Merge aggregate work was not independently claimed';
  END IF;

  SELECT * INTO STRICT v_race_prepared
  FROM dna.prepare_pro_league_aggregate_refresh(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000301',
    '43000000-0000-4000-8000-000000000201',
    v_race_claim.source_version_set_sha256
  );

  IF v_race_prepared.aggregate_family_count <> 4
     OR v_race_prepared.materialized_row_count <>
       v_core_prepared.materialized_row_count THEN
    RAISE EXCEPTION 'Race Merge aggregate preparation diverged';
  END IF;

  SELECT * INTO STRICT v_race_published
  FROM dna.publish_pro_league_aggregate_refresh(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000301',
    '43000000-0000-4000-8000-000000000201',
    'multi-source-race-worker',
    v_race_prepared.prepared_aggregate_set_id,
    v_race_prepared.source_version_set_sha256,
    v_race_prepared.aggregate_family_count,
    v_race_prepared.materialized_row_count,
    '2026-08-23T00:06:00Z'
  );

  IF v_race_published.status <> 'published'
     OR v_race_published.aggregate_set_id <>
       '43000000-0000-4000-8000-000000000301'::uuid THEN
    RAISE EXCEPTION 'Race Merge aggregate publication failed';
  END IF;
END
$multi_source_aggregate_assertions$;

DO $multi_source_aggregate_state$
DECLARE
  v_core_count bigint;
  v_race_count bigint;
BEGIN
  SELECT affected_record_count INTO STRICT v_core_count
  FROM dna.aggregate_refresh_job
  WHERE owner_id = '43000000-0000-4000-8000-000000000001'
    AND id = '43000000-0000-4000-8000-000000000302'
    AND status = 'completed';

  SELECT affected_record_count INTO STRICT v_race_count
  FROM dna.aggregate_refresh_job
  WHERE owner_id = '43000000-0000-4000-8000-000000000001'
    AND id = '43000000-0000-4000-8000-000000000301'
    AND status = 'completed';

  IF v_core_count <> 0 OR v_race_count <> v_core_count THEN
    RAISE EXCEPTION 'aggregate completion counts diverged across source families';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.aggregate_refresh_processing
    WHERE owner_id = '43000000-0000-4000-8000-000000000001'
      AND refresh_id IN (
        '43000000-0000-4000-8000-000000000301',
        '43000000-0000-4000-8000-000000000302'
      )
      AND state = 'published'
  ) <> 2 THEN
    RAISE EXCEPTION 'independent aggregate publication receipts are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.dataset_version
    WHERE owner_id = '43000000-0000-4000-8000-000000000001'
      AND id IN (
        '43000000-0000-4000-8000-000000000201',
        '43000000-0000-4000-8000-000000000202'
      )
      AND aggregate_refreshed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'multi-source aggregate freshness evidence is missing';
  END IF;
END
$multi_source_aggregate_state$;

ROLLBACK;

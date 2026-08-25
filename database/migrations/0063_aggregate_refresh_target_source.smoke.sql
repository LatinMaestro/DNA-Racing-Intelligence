BEGIN;

SET LOCAL app.owner_id = '63000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('63000000-0000-4000-8000-000000000001', 'aggregate-target-source-owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
(
  '63000000-0000-4000-8000-000000000010',
  '63000000-0000-4000-8000-000000000001',
  'race_merge', 'race.csv', repeat('a',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-25T13:00:00Z', '2026-08-25T13:01:00Z',
  '2026-08-20T00:00:00Z', '2026-08-20T01:00:00Z',
  '2026-08-20T01:00:00Z', 1, 1, 0, 0
),
(
  '63000000-0000-4000-8000-000000000011',
  '63000000-0000-4000-8000-000000000001',
  'core_details', 'cores.csv', repeat('b',64), 'utf_8', 'core_details_v1',
  'accepted', '2026-08-25T13:02:00Z', '2026-08-25T13:03:00Z',
  NULL, NULL, '2026-08-25T13:03:00Z', 1, 1, 0, 0
),
(
  '63000000-0000-4000-8000-000000000012',
  '63000000-0000-4000-8000-000000000001',
  'current_arena', 'arena.csv', repeat('c',64), 'utf_8', 'current_arena_v1',
  'accepted', '2026-08-25T13:04:00Z', '2026-08-25T13:05:00Z',
  NULL, NULL, '2026-08-25T13:05:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES
(
  '63000000-0000-4000-8000-000000000020',
  '63000000-0000-4000-8000-000000000001', 'race_merge', 1,
  '63000000-0000-4000-8000-000000000010',
  '2026-08-25T13:01:30Z', '2026-08-20T01:00:00Z', NULL, true
),
(
  '63000000-0000-4000-8000-000000000021',
  '63000000-0000-4000-8000-000000000001', 'core_details', 1,
  '63000000-0000-4000-8000-000000000011',
  '2026-08-25T13:03:30Z', '2026-08-25T13:03:00Z', NULL, true
),
(
  '63000000-0000-4000-8000-000000000022',
  '63000000-0000-4000-8000-000000000001', 'current_arena', 1,
  '63000000-0000-4000-8000-000000000012',
  '2026-08-25T13:05:30Z', '2026-08-25T13:05:00Z', NULL, true
);

INSERT INTO dna.aggregate_refresh_job (id, owner_id, dataset_version_id, status)
VALUES
(
  '63000000-0000-4000-8000-000000000030',
  '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000020', 'queued'
),
(
  '63000000-0000-4000-8000-000000000031',
  '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000021', 'queued'
),
(
  '63000000-0000-4000-8000-000000000032',
  '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000022', 'queued'
);

INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
)
SELECT
  '63000000-0000-4000-8000-000000000001', values.refresh_id,
  values.dataset_version_id, 'aggregate-target-source-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '63000000-0000-4000-8000-000000000001'
  ),
  '2026-08-25T13:10:00Z', '2099-08-25T13:10:00Z'
FROM (VALUES
  ('63000000-0000-4000-8000-000000000030'::uuid,
   '63000000-0000-4000-8000-000000000020'::uuid),
  ('63000000-0000-4000-8000-000000000031'::uuid,
   '63000000-0000-4000-8000-000000000021'::uuid),
  ('63000000-0000-4000-8000-000000000032'::uuid,
   '63000000-0000-4000-8000-000000000022'::uuid)
) AS values(refresh_id, dataset_version_id);

DO $smoke$
DECLARE
  v_hash character(64) := dna.active_pro_league_source_version_set_sha256(
    '63000000-0000-4000-8000-000000000001'
  );
BEGIN
  IF dna.pro_league_aggregate_refresh_target_source_type(
    '63000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000030',
    '63000000-0000-4000-8000-000000000020', v_hash
  ) <> 'race_merge' THEN
    RAISE EXCEPTION 'Race target source was not identified';
  END IF;
  IF dna.pro_league_aggregate_refresh_target_source_type(
    '63000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000031',
    '63000000-0000-4000-8000-000000000021', v_hash
  ) <> 'core_details' THEN
    RAISE EXCEPTION 'Core Details target source was not identified';
  END IF;
  IF dna.pro_league_aggregate_refresh_target_source_type(
    '63000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000032',
    '63000000-0000-4000-8000-000000000022', v_hash
  ) <> 'current_arena' THEN
    RAISE EXCEPTION 'Current Arena target source was not identified';
  END IF;

  BEGIN
    PERFORM dna.pro_league_aggregate_refresh_target_source_type(
      '63000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000030',
      '63000000-0000-4000-8000-000000000020', repeat('f',64)::character(64)
    );
    RAISE EXCEPTION 'stale source-version evidence was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stale source-version evidence was accepted' THEN
      RAISE;
    END IF;
  END;
END
$smoke$;

ROLLBACK;
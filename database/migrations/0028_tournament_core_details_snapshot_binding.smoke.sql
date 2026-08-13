BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('28000000-0000-4000-8000-000000000001', 'synthetic_core_snapshot_owner'),
  ('28000000-0000-4000-8000-000000000002', 'synthetic_core_snapshot_other');

SET LOCAL app.owner_id = '28000000-0000-4000-8000-000000000001';

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES
  (
    '28000000-0000-4000-8000-000000000101',
    '28000000-0000-4000-8000-000000000001',
    'race_merge', 'synthetic-core-binding-race.csv', repeat('1', 64),
    'utf_8', 'race-merge/v1', 'accepted', '2026-08-12T00:00:00Z',
    '2026-08-12T00:05:00Z', '2026-08-12T00:01:00Z',
    '2026-08-12T00:02:00Z', '2026-08-12T00:02:00Z', 1, 1, 0, 0
  ),
  (
    '28000000-0000-4000-8000-000000000102',
    '28000000-0000-4000-8000-000000000001',
    'core_details', 'synthetic-core-binding-details.csv', repeat('2', 64),
    'utf_8', 'core-details/v1', 'accepted', '2026-08-12T00:00:00Z',
    '2026-08-12T00:06:00Z', NULL, NULL, '2026-08-12T00:03:00Z',
    1, 1, 0, 0
  );

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
)
VALUES
  (
    '28000000-0000-4000-8000-000000000201',
    '28000000-0000-4000-8000-000000000001',
    'race_merge', 1, '28000000-0000-4000-8000-000000000101',
    '2026-08-12T00:07:00Z', '2026-08-12T00:02:00Z',
    '2026-08-12T00:10:00Z', true
  ),
  (
    '28000000-0000-4000-8000-000000000202',
    '28000000-0000-4000-8000-000000000001',
    'core_details', 1, '28000000-0000-4000-8000-000000000102',
    '2026-08-12T00:08:00Z', '2026-08-12T00:03:00Z', NULL, true
  );

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at,
  completed_at, affected_record_count
)
VALUES (
  '28000000-0000-4000-8000-000000000301',
  '28000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000201', 'completed',
  '2026-08-12T00:09:00Z', '2026-08-12T00:10:00Z', 1
);

INSERT INTO dna.core (
  id, owner_id, source_core_id, display_name, core_class,
  element, f_number, sex, source_import_batch_id
)
VALUES (
  '28000000-0000-4000-8000-000000000401',
  '28000000-0000-4000-8000-000000000001',
  'core-details-bound-1', 'Core Details Bound One', 'Genesis',
  'Fire', 3, 'female', '28000000-0000-4000-8000-000000000102'
);

INSERT INTO dna.core_import_provenance (
  id, owner_id, core_id, import_batch_id, source_row_number,
  raw_source_core_id, raw_source_name, is_selected_fact
)
VALUES (
  '28000000-0000-4000-8000-000000000402',
  '28000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000401',
  '28000000-0000-4000-8000-000000000102', 1,
  'core-details-bound-1', 'Core Details Bound One', true
);

INSERT INTO dna.owner_vault_core (
  id, owner_id, core_id, in_my_vault, me_eligible, version,
  created_at, updated_at
)
VALUES (
  '28000000-0000-4000-8000-000000000501',
  '28000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000401', true, false, 1,
  '2026-08-12T00:08:00Z', '2026-08-12T00:08:00Z'
);

INSERT INTO dna.core_performance_profile (
  owner_id, source_core_id, mode, distance, data_current_through,
  race_count, best_milliseconds, median_milliseconds, mean_milliseconds,
  trimmed_mean_milliseconds, standard_deviation_milliseconds,
  interquartile_range_milliseconds, best_metres_per_second,
  median_metres_per_second, refreshed_at
)
VALUES (
  '28000000-0000-4000-8000-000000000001', 'core-details-bound-1',
  'bike', 1200, '2026-08-12T00:02:00Z', 1, 60000, 60000,
  60000, 60000, 0, 0, 20, 20, '2026-08-12T00:10:00Z'
);

CREATE TEMP TABLE initial_snapshot AS
SELECT dna.derive_tournament_candidate_snapshot(
  '28000000-0000-4000-8000-000000000001', 'cfg-core-v1'
) AS snapshot_version;

DO $initial_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM initial_snapshot
    WHERE snapshot_version LIKE 'snapshot-%'
      AND snapshot_version <> 'snapshot-unbound'
      AND length(snapshot_version) = 41
  ) THEN
    RAISE EXCEPTION 'Core Details evidence was not bound';
  END IF;
END
$initial_assertions$;

UPDATE dna.core
SET element = 'Metal', updated_at = '2026-08-12T00:11:00Z'
WHERE owner_id = '28000000-0000-4000-8000-000000000001'
  AND id = '28000000-0000-4000-8000-000000000401';

DO $metadata_drift_assertions$
DECLARE
  v_current text;
BEGIN
  v_current := dna.derive_tournament_candidate_snapshot(
    '28000000-0000-4000-8000-000000000001', 'cfg-core-v1'
  );
  IF v_current = (SELECT snapshot_version FROM initial_snapshot) THEN
    RAISE EXCEPTION 'Core Details metadata drift did not change snapshot identity';
  END IF;
END
$metadata_drift_assertions$;

CREATE TEMP TABLE active_snapshot AS
SELECT dna.derive_tournament_candidate_snapshot(
  '28000000-0000-4000-8000-000000000001', 'cfg-core-v1'
) AS snapshot_version;

UPDATE dna.core_import_provenance
SET is_selected_fact = false
WHERE owner_id = '28000000-0000-4000-8000-000000000001'
  AND core_id = '28000000-0000-4000-8000-000000000401';

DO $active_state_assertions$
DECLARE
  v_current text;
BEGIN
  v_current := dna.derive_tournament_candidate_snapshot(
    '28000000-0000-4000-8000-000000000001', 'cfg-core-v1'
  );
  IF v_current = (SELECT snapshot_version FROM active_snapshot)
    OR v_current = 'snapshot-unbound'
  THEN
    RAISE EXCEPTION 'Core Details active-state drift was not bound safely';
  END IF;
END
$active_state_assertions$;

UPDATE dna.dataset_version
SET is_active = false
WHERE owner_id = '28000000-0000-4000-8000-000000000001'
  AND source_type = 'core_details';

DO $missing_dataset_assertions$
BEGIN
  IF dna.derive_tournament_candidate_snapshot(
    '28000000-0000-4000-8000-000000000001', 'cfg-core-v1'
  ) <> 'snapshot-unbound' THEN
    RAISE EXCEPTION 'missing active Core Details dataset did not fail closed';
  END IF;
END
$missing_dataset_assertions$;

SET LOCAL app.owner_id = '28000000-0000-4000-8000-000000000002';

DO $owner_isolation$
BEGIN
  BEGIN
    PERFORM dna.derive_tournament_candidate_snapshot(
      '28000000-0000-4000-8000-000000000001', 'cfg-core-v1'
    );
    RAISE EXCEPTION 'cross-owner Core Details snapshot derivation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Core Details snapshot derivation was accepted' THEN
      RAISE;
    END IF;
  END;
END
$owner_isolation$;

ROLLBACK;

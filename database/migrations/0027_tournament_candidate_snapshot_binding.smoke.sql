BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  (
    '27000000-0000-4000-8000-000000000001',
    'synthetic_tournament_snapshot_owner'
  ),
  (
    '27000000-0000-4000-8000-000000000002',
    'synthetic_tournament_snapshot_other'
  );

SET LOCAL app.owner_id = '27000000-0000-4000-8000-000000000001';

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
  import_completed_at,
  minimum_accepted_event_at,
  maximum_accepted_event_at,
  dataset_current_through_after_import,
  source_rows,
  accepted_rows,
  rejected_rows,
  warning_rows
)
VALUES (
  '27000000-0000-4000-8000-000000000101',
  '27000000-0000-4000-8000-000000000001',
  'race_merge',
  'synthetic-snapshot-race.csv',
  repeat('1', 64),
  'utf_8',
  'race-merge/v1',
  'accepted',
  '2026-08-11T00:00:00Z',
  '2026-08-11T00:05:00Z',
  '2026-08-11T00:01:00Z',
  '2026-08-11T00:02:00Z',
  '2026-08-11T00:02:00Z',
  1,
  1,
  0,
  0
);

INSERT INTO dna.dataset_version (
  id,
  owner_id,
  source_type,
  version_number,
  import_batch_id,
  activated_at,
  data_current_through,
  aggregate_refreshed_at,
  is_active
)
VALUES (
  '27000000-0000-4000-8000-000000000201',
  '27000000-0000-4000-8000-000000000001',
  'race_merge',
  1,
  '27000000-0000-4000-8000-000000000101',
  '2026-08-11T00:06:00Z',
  '2026-08-11T00:02:00Z',
  '2026-08-11T00:10:00Z',
  true
);

INSERT INTO dna.aggregate_refresh_job (
  id,
  owner_id,
  dataset_version_id,
  status,
  started_at,
  completed_at,
  affected_record_count
)
VALUES (
  '27000000-0000-4000-8000-000000000301',
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000201',
  'completed',
  '2026-08-11T00:09:00Z',
  '2026-08-11T00:10:00Z',
  1
);

INSERT INTO dna.core (
  id,
  owner_id,
  source_core_id,
  display_name,
  source_import_batch_id
)
VALUES (
  '27000000-0000-4000-8000-000000000401',
  '27000000-0000-4000-8000-000000000001',
  'snapshot-core-1',
  'Snapshot Core One',
  '27000000-0000-4000-8000-000000000101'
);

INSERT INTO dna.owner_vault_core (
  id,
  owner_id,
  core_id,
  in_my_vault,
  me_eligible,
  version,
  created_at,
  updated_at
)
VALUES (
  '27000000-0000-4000-8000-000000000501',
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000401',
  true,
  false,
  1,
  '2026-08-11T00:07:00Z',
  '2026-08-11T00:07:00Z'
);

INSERT INTO dna.core_performance_profile (
  owner_id,
  source_core_id,
  mode,
  distance,
  data_current_through,
  race_count,
  best_milliseconds,
  median_milliseconds,
  mean_milliseconds,
  trimmed_mean_milliseconds,
  standard_deviation_milliseconds,
  interquartile_range_milliseconds,
  best_metres_per_second,
  median_metres_per_second,
  refreshed_at
)
VALUES (
  '27000000-0000-4000-8000-000000000001',
  'snapshot-core-1',
  'bike',
  1200,
  '2026-08-11T00:02:00Z',
  1,
  60000,
  60000,
  60000,
  60000,
  0,
  0,
  20,
  20,
  '2026-08-11T00:10:00Z'
);

CREATE TEMP TABLE configuration_result AS
SELECT *
FROM dna.upsert_complete_tournament_configuration(
  '27000000-0000-4000-8000-000000000001',
  'snapshot-cup',
  'Snapshot Cup',
  'Season 12',
  '2026-09-01T00:00:00Z',
  '2026-09-07T23:59:59Z',
  'bike-element',
  'Bike element split',
  'bike',
  ARRAY[1200],
  4,
  0.01,
  'USD',
  'paid qualification',
  ARRAY['Genesis'],
  ARRAY['Bike'],
  ARRAY['Fire'],
  ARRAY[1],
  '[{"minimum":1,"maximum":1}]'::jsonb,
  '[]'::jsonb,
  'element_group',
  '[{"id":"fire","label":"Fire"}]'::jsonb,
  5,
  NULL,
  10,
  'top_x_finishes',
  3,
  '{"1":"10","2":"6","3":"3"}'::jsonb,
  '{}'::jsonb,
  'separate',
  'priority',
  'confirmed',
  'Synthetic confirmed snapshot rule.',
  'Synthetic snapshot rule evidence.',
  '{"source":"owner_entry","version":"snapshot-rules-v1"}'::jsonb,
  NULL
);

DO $initial_unbound$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.list_bound_tournament_configurations(
      '27000000-0000-4000-8000-000000000001'
    ) configuration
    WHERE configuration.tournament_id = 'snapshot-cup'
      AND configuration.candidate_snapshot_version = 'snapshot-unbound'
  ) THEN
    RAISE EXCEPTION 'unpublished candidate evidence was treated as bound';
  END IF;
END
$initial_unbound$;

CREATE TEMP TABLE initial_binding AS
SELECT dna.bind_tournament_candidate_snapshot(
  '27000000-0000-4000-8000-000000000001',
  'snapshot-cup',
  'bike-element',
  configuration.configuration_version
) AS snapshot_version
FROM configuration_result configuration;

DO $binding_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM initial_binding binding
    WHERE binding.snapshot_version LIKE 'snapshot-%'
      AND binding.snapshot_version <> 'snapshot-unbound'
      AND length(binding.snapshot_version) = 41
  ) THEN
    RAISE EXCEPTION 'server-derived candidate snapshot was not bound';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.list_bound_tournament_configurations(
      '27000000-0000-4000-8000-000000000001'
    ) configuration
    JOIN initial_binding binding
      ON binding.snapshot_version =
        configuration.candidate_snapshot_version
    WHERE configuration.tournament_id = 'snapshot-cup'
  ) THEN
    RAISE EXCEPTION 'bound candidate snapshot was not verified on read';
  END IF;

  IF (
    SELECT dna.bind_tournament_candidate_snapshot(
      '27000000-0000-4000-8000-000000000001',
      'snapshot-cup',
      'bike-element',
      configuration.configuration_version
    )
    FROM configuration_result configuration
  ) <> (
    SELECT binding.snapshot_version
    FROM initial_binding binding
  ) THEN
    RAISE EXCEPTION 'candidate snapshot replay was not deterministic';
  END IF;
END
$binding_assertions$;

UPDATE dna.owner_vault_core
SET
  me_eligible = true,
  version = 2,
  updated_at = '2026-08-11T00:11:00Z'
WHERE owner_id = '27000000-0000-4000-8000-000000000001'
  AND core_id = '27000000-0000-4000-8000-000000000401';

DO $vault_drift_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.list_bound_tournament_configurations(
      '27000000-0000-4000-8000-000000000001'
    ) configuration
    WHERE configuration.tournament_id = 'snapshot-cup'
      AND configuration.candidate_snapshot_version = 'snapshot-unbound'
  ) THEN
    RAISE EXCEPTION 'Vault candidate drift did not fail closed';
  END IF;
END
$vault_drift_assertions$;

CREATE TEMP TABLE rebound_result AS
SELECT dna.bind_tournament_candidate_snapshot(
  '27000000-0000-4000-8000-000000000001',
  'snapshot-cup',
  'bike-element',
  configuration.configuration_version
) AS snapshot_version
FROM configuration_result configuration;

DO $rebind_assertions$
BEGIN
  IF (
    SELECT rebound.snapshot_version
    FROM rebound_result rebound
  ) = (
    SELECT initial.snapshot_version
    FROM initial_binding initial
  ) THEN
    RAISE EXCEPTION 'Vault candidate drift did not change snapshot identity';
  END IF;

  BEGIN
    PERFORM dna.bind_tournament_candidate_snapshot(
      '27000000-0000-4000-8000-000000000001',
      'snapshot-cup',
      'bike-element',
      'cfg-stale'
    );
    RAISE EXCEPTION 'stale configuration version was accepted for binding';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stale configuration version was accepted for binding' THEN
      RAISE;
    END IF;
  END;
END
$rebind_assertions$;

UPDATE dna.aggregate_refresh_job
SET
  status = 'failed',
  completed_at = NULL,
  affected_record_count = NULL,
  failure_code = 'SYNTHETIC_FAILURE'
WHERE owner_id = '27000000-0000-4000-8000-000000000001';

DO $aggregate_failure_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.list_bound_tournament_configurations(
      '27000000-0000-4000-8000-000000000001'
    ) configuration
    WHERE configuration.candidate_snapshot_version = 'snapshot-unbound'
  ) THEN
    RAISE EXCEPTION 'failed aggregate evidence did not fail closed';
  END IF;

  BEGIN
    PERFORM dna.bind_tournament_candidate_snapshot(
      '27000000-0000-4000-8000-000000000001',
      'snapshot-cup',
      'bike-element',
      configuration.configuration_version
    )
    FROM configuration_result configuration;
    RAISE EXCEPTION 'incomplete aggregate evidence was bound';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete aggregate evidence was bound' THEN
      RAISE;
    END IF;
  END;
END
$aggregate_failure_assertions$;

UPDATE dna.aggregate_refresh_job
SET
  status = 'completed',
  completed_at = '2026-08-11T00:10:00Z',
  affected_record_count = 1,
  failure_code = NULL
WHERE owner_id = '27000000-0000-4000-8000-000000000001';

UPDATE dna.core_performance_profile
SET refreshed_at = '2026-08-11T00:09:59Z'
WHERE owner_id = '27000000-0000-4000-8000-000000000001';

DO $profile_drift_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.list_bound_tournament_configurations(
      '27000000-0000-4000-8000-000000000001'
    ) configuration
    WHERE configuration.candidate_snapshot_version = 'snapshot-unbound'
  ) THEN
    RAISE EXCEPTION 'stale performance profile evidence did not fail closed';
  END IF;
END
$profile_drift_assertions$;

DO $grant_assertions$
BEGIN
  IF has_function_privilege(
    'public',
    'dna.bind_tournament_candidate_snapshot(uuid,text,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'public',
    'dna.list_bound_tournament_configurations(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.bind_tournament_candidate_snapshot(uuid,text,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.list_bound_tournament_configurations(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Tournament candidate snapshot grants are not minimal';
  END IF;
END
$grant_assertions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '27000000-0000-4000-8000-000000000002';

DO $owner_isolation$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.list_bound_tournament_configurations(
      '27000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner bound Tournament read was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner bound Tournament read was accepted' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM dna.bind_tournament_candidate_snapshot(
      '27000000-0000-4000-8000-000000000001',
      'snapshot-cup',
      'bike-element',
      (
        SELECT configuration_version
        FROM configuration_result
      )
    );
    RAISE EXCEPTION 'cross-owner Tournament binding was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Tournament binding was accepted' THEN
      RAISE;
    END IF;
  END;
END
$owner_isolation$;

ROLLBACK;

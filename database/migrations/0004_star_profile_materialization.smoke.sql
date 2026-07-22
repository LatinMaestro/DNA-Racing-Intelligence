BEGIN;

SET LOCAL app.owner_id = '40000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '40000000-0000-4000-8000-000000000001',
  'synthetic_star_profile_owner'
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
  '40000000-0000-4000-8000-000000000101',
  '40000000-0000-4000-8000-000000000001',
  'race_merge',
  'synthetic-star-profile.csv',
  repeat('a', 64),
  'utf_8',
  'race-merge/v1',
  'accepted',
  '2026-07-23T04:00:00Z',
  '2026-07-23T04:05:00Z',
  '2026-07-23T01:00:00Z',
  '2026-07-23T04:00:00Z',
  '2026-07-23T04:00:00Z',
  8,
  8,
  0,
  2
);

INSERT INTO dna.dataset_version (
  id,
  owner_id,
  source_type,
  version_number,
  import_batch_id,
  activated_at,
  data_current_through,
  is_active
)
VALUES (
  '40000000-0000-4000-8000-000000000201',
  '40000000-0000-4000-8000-000000000001',
  'race_merge',
  1,
  '40000000-0000-4000-8000-000000000101',
  '2026-07-23T04:06:00Z',
  '2026-07-23T04:00:00Z',
  true
);

INSERT INTO dna.aggregate_refresh_job (
  id,
  owner_id,
  dataset_version_id,
  status
)
VALUES (
  '40000000-0000-4000-8000-000000000301',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000201',
  'queued'
);

INSERT INTO dna.race_event (
  id,
  owner_id,
  source_event_id,
  event_at,
  mode,
  distance,
  gate_count,
  source_import_batch_id,
  active_in_dataset
)
VALUES
  ('40000000-0000-4000-8000-000000000401', '40000000-0000-4000-8000-000000000001', 'event-assigned', '2026-07-23T01:00:00Z', 'bike', 1000, 4, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000402', '40000000-0000-4000-8000-000000000001', 'event-ineligible', '2026-07-23T02:00:00Z', 'bike', 1000, 3, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000403', '40000000-0000-4000-8000-000000000001', 'event-ambiguous', '2026-07-23T03:00:00Z', 'bike', 1000, 6, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000404', '40000000-0000-4000-8000-000000000001', 'event-partial', '2026-07-23T04:00:00Z', 'bike', 1000, 6, '40000000-0000-4000-8000-000000000101', true);

INSERT INTO dna.race_entry (
  id,
  owner_id,
  race_event_id,
  source_core_id,
  gate_count,
  gold_star,
  blue_star,
  star_data_status,
  finish_position,
  source_import_batch_id,
  active_in_dataset
)
VALUES
  ('40000000-0000-4000-8000-000000000501', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000401', 'core-a', 4, true, false, 'complete', 1, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000502', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000401', 'core-b', 4, false, true, 'complete', 2, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000503', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000402', 'core-a', 3, true, false, 'complete', 1, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000504', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000402', 'core-b', 3, false, false, 'complete', 2, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000505', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000403', 'core-a', 6, true, true, 'complete', 1, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000506', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000403', 'core-b', 6, true, false, 'complete', 2, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000507', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000404', 'core-a', 6, true, NULL, 'partial', 1, '40000000-0000-4000-8000-000000000101', true),
  ('40000000-0000-4000-8000-000000000508', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000404', 'core-b', 6, false, false, 'complete', 2, '40000000-0000-4000-8000-000000000101', true);

SELECT *
FROM dna.refresh_star_profiles(
  '40000000-0000-4000-8000-000000000201',
  '2026-07-23T04:10:00Z'
);

DO $refresh_assertions$
BEGIN
  IF (
    SELECT count(*) FROM dna.event_star_validation
  ) <> 4 OR (
    SELECT count(*) FROM dna.core_star_profile
  ) <> 2 THEN
    RAISE EXCEPTION 'Star validation or profile counts are wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.event_star_validation validation
    JOIN dna.race_event event ON event.id = validation.race_event_id
    WHERE
      event.source_event_id = 'event-ambiguous'
      AND validation.gold_assignment_count = 2
      AND validation.gold_source_core_id IS NULL
      AND validation.gold_source_core_ids = ARRAY['core-a', 'core-b']
      AND NOT validation.gold_assignment_opportunity
      AND validation.validation_status = 'invalid'
      AND validation.warning_codes @> ARRAY['MULTIPLE_GOLD_ASSIGNMENTS']
  ) THEN
    RAISE EXCEPTION 'Ambiguous Gold assignment selected a false winner';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.event_star_validation validation
    JOIN dna.race_event event ON event.id = validation.race_event_id
    WHERE
      event.source_event_id = 'event-ineligible'
      AND NOT validation.gold_star_eligible
      AND NOT validation.gold_assignment_opportunity
      AND validation.warning_codes @> ARRAY['GOLD_INELIGIBLE_ASSIGNMENT']
  ) THEN
    RAISE EXCEPTION 'Gold-ineligible anomaly was not preserved and excluded';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.event_star_validation validation
    JOIN dna.race_event event ON event.id = validation.race_event_id
    WHERE
      event.source_event_id = 'event-partial'
      AND validation.gold_data_complete
      AND NOT validation.blue_data_complete
      AND validation.gold_assignment_opportunity
      AND NOT validation.blue_assignment_opportunity
  ) THEN
    RAISE EXCEPTION 'Gold and Blue completeness were not kept independent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.core_star_profile
    WHERE
      source_core_id = 'core-a'
      AND mode = 'bike'
      AND distance = 1000
      AND data_current_through = '2026-07-23T04:00:00Z'
      AND race_count = 4
      AND complete_star_data_race_count = 3
      AND partial_star_data_race_count = 1
      AND gold_eligible_race_count = 3
      AND gold_assignment_opportunity_count = 2
      AND gold_received_count = 2
      AND gold_negative_opportunity_count = 0
      AND gold_ineligible_assignment_count = 1
      AND gold_excluded_anomaly_count = 1
      AND blue_assignment_opportunity_count = 2
      AND blue_received_count = 1
      AND blue_negative_opportunity_count = 1
      AND blue_no_assignment_count = 1
      AND blue_excluded_anomaly_count = 1
  ) THEN
    RAISE EXCEPTION 'Core star profile denominators or coverage are wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_job
    WHERE
      id = '40000000-0000-4000-8000-000000000301'
      AND status = 'completed'
      AND started_at = '2026-07-23T04:10:00Z'
      AND completed_at = '2026-07-23T04:10:00Z'
      AND affected_record_count = 6
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE
      id = '40000000-0000-4000-8000-000000000201'
      AND aggregate_refreshed_at = '2026-07-23T04:10:00Z'
  ) THEN
    RAISE EXCEPTION 'Aggregate completion was claimed incorrectly';
  END IF;
END
$refresh_assertions$;

SELECT *
FROM dna.refresh_star_profiles(
  '40000000-0000-4000-8000-000000000201',
  '2026-07-23T04:11:00Z'
);

DO $replay_assertions$
BEGIN
  IF (
    SELECT count(*) FROM dna.event_star_validation
  ) <> 4 OR (
    SELECT count(*) FROM dna.core_star_profile
  ) <> 2 OR NOT EXISTS (
    SELECT 1 FROM dna.dataset_version
    WHERE
      id = '40000000-0000-4000-8000-000000000201'
      AND aggregate_refreshed_at = '2026-07-23T04:11:00Z'
  ) THEN
    RAISE EXCEPTION 'Star-profile replay was not deterministic';
  END IF;
END
$replay_assertions$;

DO $security_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc proc
    JOIN pg_namespace ns ON ns.oid = proc.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(proc.proacl, acldefault('f', proc.proowner))
    ) acl
    WHERE
      ns.nspname = 'dna'
      AND proc.proname = 'refresh_star_profiles'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Star-profile refresh is executable by PUBLIC';
  END IF;
END
$security_assertions$;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '40000000-0000-4000-8000-000000000002',
  'synthetic_star_profile_other_owner'
);

INSERT INTO dna.core_star_profile (
  owner_id,
  source_core_id,
  mode,
  distance,
  data_current_through,
  race_count,
  complete_star_data_race_count,
  partial_star_data_race_count,
  missing_star_data_race_count,
  invalid_star_data_race_count,
  gold_eligible_race_count,
  gold_assignment_opportunity_count,
  gold_received_count,
  gold_negative_opportunity_count,
  gold_eligible_no_assignment_count,
  gold_ineligible_assignment_count,
  gold_excluded_anomaly_count,
  blue_assignment_opportunity_count,
  blue_received_count,
  blue_negative_opportunity_count,
  blue_no_assignment_count,
  blue_excluded_anomaly_count,
  same_core_received_both_count,
  refreshed_at
)
VALUES (
  '40000000-0000-4000-8000-000000000002',
  'other-core',
  'bike',
  1000,
  '2026-07-23T04:00:00Z',
  1,
  1, 0, 0, 0,
  1,
  0, 0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
  0,
  '2026-07-23T04:10:00Z'
);

CREATE ROLE dna_ci_star_profile NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_star_profile;
GRANT SELECT ON dna.core_star_profile TO dna_ci_star_profile;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_star_profile;

SET LOCAL ROLE dna_ci_star_profile;
SET LOCAL app.owner_id = '40000000-0000-4000-8000-000000000001';

DO $rls_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.core_star_profile
    WHERE owner_id = '40000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Core star-profile RLS exposed another owner';
  END IF;
END
$rls_assertions$;

RESET ROLE;

ROLLBACK;

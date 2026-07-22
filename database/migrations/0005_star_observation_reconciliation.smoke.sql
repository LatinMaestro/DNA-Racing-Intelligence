BEGIN;

SET LOCAL app.owner_id = '50000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('50000000-0000-4000-8000-000000000001', 'synthetic_reconciliation_owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at, import_completed_at,
  minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
)
VALUES (
  '50000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-reconciliation.csv', repeat('a', 64),
  'utf_8', 'race-merge/v1', 'accepted',
  '2026-07-23T05:00:00Z', '2026-07-23T05:05:00Z',
  '2026-07-23T01:00:00Z', '2026-07-23T04:00:00Z',
  '2026-07-23T04:00:00Z', 8, 8, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
)
VALUES (
  '50000000-0000-4000-8000-000000000201',
  '50000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '50000000-0000-4000-8000-000000000101',
  '2026-07-23T05:06:00Z', '2026-07-23T04:00:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (id, owner_id, dataset_version_id, status)
VALUES (
  '50000000-0000-4000-8000-000000000301',
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000201',
  'queued'
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
)
VALUES
  ('50000000-0000-4000-8000-000000000401', '50000000-0000-4000-8000-000000000001', 'authoritative-exact', '2026-07-23T01:00:00Z', 'bike', 1000, 4, '50000000-0000-4000-8000-000000000101', true),
  ('50000000-0000-4000-8000-000000000402', '50000000-0000-4000-8000-000000000001', 'authoritative-mismatch', '2026-07-23T02:00:00Z', 'bike', 1000, 4, '50000000-0000-4000-8000-000000000101', true),
  ('50000000-0000-4000-8000-000000000403', '50000000-0000-4000-8000-000000000001', 'candidate-event', '2026-07-23T03:00:00Z', 'bike', 1000, 4, '50000000-0000-4000-8000-000000000101', true),
  ('50000000-0000-4000-8000-000000000404', '50000000-0000-4000-8000-000000000001', 'authoritative-ineligible', '2026-07-23T04:00:00Z', 'bike', 1000, 3, '50000000-0000-4000-8000-000000000101', true);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count, gold_star,
  blue_star, star_data_status, finish_position, source_import_batch_id,
  active_in_dataset
)
SELECT
  md5('entry:' || event.id::text || ':' || core.source_core_id)::uuid,
  event.owner_id,
  event.id,
  core.source_core_id,
  event.gate_count,
  CASE
    WHEN event.gate_count > 3 AND core.source_core_id = 'core-a' THEN true
    ELSE false
  END,
  core.source_core_id = 'core-b',
  'complete',
  core.finish_position,
  event.source_import_batch_id,
  true
FROM dna.race_event event
CROSS JOIN (VALUES ('core-a', 1::smallint), ('core-b', 2::smallint))
  AS core(source_core_id, finish_position)
WHERE event.owner_id = '50000000-0000-4000-8000-000000000001';

SELECT * FROM dna.refresh_star_profiles(
  '50000000-0000-4000-8000-000000000201',
  '2026-07-23T05:10:00Z'
);

INSERT INTO dna.manual_star_observation (
  id, owner_id, reconciliation_key, key_authority,
  authoritative_source_event_id, event_starts_at, mode, distance, gate_count,
  observed_gold_source_core_id, observed_blue_source_core_id, observed_at
)
VALUES
  ('50000000-0000-4000-8000-000000000501', '50000000-0000-4000-8000-000000000001', 'manual-star-event-exact', 'authoritative_event_id', 'authoritative-exact', '2026-07-23T01:00:00Z', 'bike', 1000, 4, 'core-a', 'core-b', '2026-07-23T01:00:01Z'),
  ('50000000-0000-4000-8000-000000000502', '50000000-0000-4000-8000-000000000001', 'manual-star-event-mismatch', 'authoritative_event_id', 'authoritative-mismatch', '2026-07-23T02:00:00Z', 'bike', 1000, 4, 'core-b', 'core-a', '2026-07-23T02:00:01Z'),
  ('50000000-0000-4000-8000-000000000503', '50000000-0000-4000-8000-000000000001', 'manual-star-candidate', 'candidate_only', NULL, '2026-07-23T03:00:00Z', 'bike', 1000, 4, 'core-a', 'core-b', '2026-07-23T03:00:01Z'),
  ('50000000-0000-4000-8000-000000000504', '50000000-0000-4000-8000-000000000001', 'manual-star-event-ineligible', 'authoritative_event_id', 'authoritative-ineligible', '2026-07-23T04:00:00Z', 'bike', 1000, 3, 'core-a', 'core-b', '2026-07-23T04:00:01Z'),
  ('50000000-0000-4000-8000-000000000505', '50000000-0000-4000-8000-000000000001', 'manual-star-event-not-imported', 'authoritative_event_id', 'not-imported-yet', '2026-07-23T05:00:00Z', 'bike', 1000, 4, 'core-a', 'core-b', '2026-07-23T05:00:01Z');

INSERT INTO dna.manual_star_observation_entry (
  id, owner_id, observation_id, source_core_id, is_owner_entry
)
SELECT
  md5('observation-entry:' || observation.id::text || ':' || core.source_core_id)::uuid,
  observation.owner_id,
  observation.id,
  core.source_core_id,
  core.source_core_id = 'core-a'
FROM dna.manual_star_observation observation
CROSS JOIN (VALUES ('core-a'), ('core-b')) AS core(source_core_id)
WHERE observation.owner_id = '50000000-0000-4000-8000-000000000001';

SELECT * FROM dna.reconcile_manual_star_observations('2026-07-23T05:15:00Z');

DO $reconciliation_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM dna.manual_star_observation
    WHERE id = '50000000-0000-4000-8000-000000000501'
      AND reconciliation_status = 'reconciled'
      AND warning_codes = '{}'
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.star_observation_reconciliation reconciliation
    WHERE observation_id = '50000000-0000-4000-8000-000000000501'
      AND result = 'exact_match'
      AND detail_code IS NULL
  ) THEN
    RAISE EXCEPTION 'Authoritative exact observation was not reconciled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.manual_star_observation
    WHERE id = '50000000-0000-4000-8000-000000000502'
      AND reconciliation_status = 'mismatch'
      AND warning_codes @> ARRAY['STAR_ASSIGNMENT_MISMATCH']
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.star_observation_reconciliation
    WHERE observation_id = '50000000-0000-4000-8000-000000000502'
      AND result = 'mismatch'
      AND detail_code = 'STAR_ASSIGNMENT_MISMATCH'
  ) THEN
    RAISE EXCEPTION 'Authoritative star mismatch was not surfaced';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.manual_star_observation observation
    JOIN dna.race_event event ON event.id = observation.reconciled_race_event_id
    WHERE observation.id = '50000000-0000-4000-8000-000000000503'
      AND observation.reconciliation_status = 'review_required'
      AND event.source_event_id = 'candidate-event'
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.star_observation_reconciliation
    WHERE observation_id = '50000000-0000-4000-8000-000000000503'
      AND result = 'review_required'
      AND detail_code = 'CANDIDATE_MATCH_REQUIRES_REVIEW'
  ) THEN
    RAISE EXCEPTION 'Candidate-only observation was auto-accepted or not proposed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.manual_star_observation
    WHERE id = '50000000-0000-4000-8000-000000000504'
      AND reconciliation_status = 'mismatch'
      AND warning_codes @> ARRAY['GOLD_INELIGIBLE_OBSERVATION']
  ) THEN
    RAISE EXCEPTION 'Ineligible manual Gold was not surfaced';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.manual_star_observation
    WHERE id = '50000000-0000-4000-8000-000000000505'
      AND reconciliation_status = 'review_required'
      AND reconciled_race_event_id IS NULL
      AND warning_codes @> ARRAY['AUTHORITATIVE_EVENT_NOT_IMPORTED']
  ) OR EXISTS (
    SELECT 1 FROM dna.star_observation_reconciliation
    WHERE observation_id = '50000000-0000-4000-8000-000000000505'
  ) THEN
    RAISE EXCEPTION 'Not-yet-imported authoritative event was falsely linked';
  END IF;

  IF (SELECT count(*) FROM dna.star_observation_reconciliation) <> 4
    OR (SELECT count(*) FROM dna.core_star_profile) <> 2 THEN
    RAISE EXCEPTION 'Reconciliation duplicated evidence or changed profiles';
  END IF;
END
$reconciliation_assertions$;

SELECT * FROM dna.reconcile_manual_star_observations('2026-07-23T05:16:00Z');

DO $replay_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.star_observation_reconciliation) <> 4
    OR (SELECT count(*) FROM dna.core_star_profile) <> 2 THEN
    RAISE EXCEPTION 'Reconciliation replay duplicated records or aggregate evidence';
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
      AND proc.proname = 'reconcile_manual_star_observations'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Observation reconciliation is executable by PUBLIC';
  END IF;
END
$security_assertions$;

ROLLBACK;

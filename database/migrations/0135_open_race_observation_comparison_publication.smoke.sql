BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91350000-0000-4000-8000-000000000001', 'smoke_open_race_observation_owner'),
  ('91350000-0000-4000-8000-000000000002', 'smoke_open_race_observation_other');

WITH fixture AS (
  SELECT jsonb_build_object(
    'version', 1,
    'databaseOwnerId', '91350000-0000-4000-8000-000000000001',
    'publishedAt', '2020-10-16T05:00:00.000Z',
    'evidence', jsonb_build_object(
      'bindings', jsonb_build_object(
        'sessionVersion', 'session-locked',
        'fieldVersion', 'field-v1',
        'eligibilityVersion', 'eligibility-v1',
        'historicalAggregateVersion', 'aggregate-v1',
        'raceImportVersion', 'race-v1',
        'vaultSnapshotVersion', 'vault-v1',
        'rankingVersion', 'ranking-v1',
        'lockVersion', 'lock-v1',
        'observationVersion', NULL,
        'comparisonVersion', NULL),
      'field', jsonb_build_object('requestId', 'request-observation'),
      'eligibility', jsonb_build_object('evaluationId', 'eligibility-v1'),
      'ranking', jsonb_build_object(
        'rankingId', 'ranking-v1',
        'evaluatedAt', '2020-10-16T04:10:00.000Z'),
      'lock', jsonb_build_object(
        'lockId', 'lock-v1',
        'lockedAt', '2020-10-16T05:00:00.000Z',
        'gateCount', 4,
        'enteredCoreIds', jsonb_build_array(
          'owned-1','opponent-1','opponent-2','opponent-3'),
        'selectedOwnedCoreId', 'owned-1'),
      'observation', NULL,
      'comparison', NULL))::text AS body
)
INSERT INTO dna.open_race_workspace_session_snapshot (
  owner_id, request_id, session_version, field_version, eligibility_version,
  race_import_version, vault_snapshot_version, historical_aggregate_version,
  mode, distance_meters, field_captured_at, latest_accepted_race_import_at,
  latest_accepted_vault_import_at, published_at, snapshot_sha256, snapshot_json)
SELECT '91350000-0000-4000-8000-000000000001', 'request-observation',
  'session-locked', 'field-v1', 'eligibility-v1', 'race-v1', 'vault-v1',
  'aggregate-v1', 'horse', 1600, '2020-10-16T04:00:00Z',
  '2020-10-16T03:00:00Z', '2020-10-16T03:00:00Z',
  '2020-10-16T05:00:00Z',
  encode(sha256(convert_to(body, 'UTF8')), 'hex'), body
FROM fixture;

DO $checks$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.publish_open_race_observation_comparison(uuid,text,text,text,timestamp with time zone,text,text)',
    'EXECUTE')
  THEN
    RAISE EXCEPTION 'runtime Open Race observation publication permission missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
    WHERE p.oid = 'dna.publish_open_race_observation_comparison(uuid,text,text,text,timestamp with time zone,text,text)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
  THEN
    RAISE EXCEPTION 'public Open Race observation publication permission present';
  END IF;
END
$checks$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91350000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE
  v_old_text text;
  v_old_sha text;
  v_candidate jsonb;
  v_candidate_text text;
  v_candidate_sha text;
  v_result text;
BEGIN
  SELECT snapshot_json, snapshot_sha256 INTO v_old_text, v_old_sha
  FROM dna.read_open_race_workspace_sessions(dna.current_owner_id(), 1);

  v_candidate := jsonb_set(v_old_text::jsonb, '{publishedAt}',
    to_jsonb('2020-10-16T05:05:00.000Z'::text));
  v_candidate := jsonb_set(v_candidate,
    '{evidence,bindings,sessionVersion}', to_jsonb('session-observed'::text));
  v_candidate := jsonb_set(v_candidate,
    '{evidence,bindings,observationVersion}', to_jsonb('observation-v1'::text));
  v_candidate := jsonb_set(v_candidate,
    '{evidence,bindings,comparisonVersion}', to_jsonb('comparison-v1'::text));
  v_candidate := jsonb_set(v_candidate, '{evidence,observation}', jsonb_build_object(
    'observationId', 'observation-v1',
    'lockId', 'lock-v1',
    'lockedAt', '2020-10-16T05:00:00.000Z',
    'observedAt', '2020-10-16T05:05:00.000Z',
    'fieldStage', 'locked_observation',
    'gateCount', 4,
    'enteredCoreIds', jsonb_build_array('owned-1','opponent-1','opponent-2','opponent-3'),
    'selectedOwnedCoreId', 'owned-1',
    'rankedCandidateCoreIds', jsonb_build_array('owned-1'),
    'provisionalRecommendedCoreId', NULL,
    'gold', jsonb_build_object('status', 'assigned', 'coreId', 'opponent-1'),
    'blue', jsonb_build_object('status', 'assigned', 'coreId', 'owned-1'),
    'observationRecordStatus', 'recorded'));
  v_candidate := jsonb_set(v_candidate, '{evidence,comparison}', jsonb_build_object(
    'comparisonId', 'comparison-v1',
    'lockId', 'lock-v1',
    'observationId', 'observation-v1',
    'rankingEvaluatedAt', '2020-10-16T04:10:00.000Z',
    'lockedAt', '2020-10-16T05:00:00.000Z',
    'observedAt', '2020-10-16T05:05:00.000Z',
    'comparedAt', '2020-10-16T05:05:00.000Z',
    'gateCount', 4,
    'enteredCoreIds', jsonb_build_array('owned-1','opponent-1','opponent-2','opponent-3'),
    'selectedOwnedCoreId', 'owned-1',
    'gold', jsonb_build_object('status', 'assigned', 'coreId', 'opponent-1'),
    'blue', jsonb_build_object('status', 'assigned', 'coreId', 'owned-1')));

  v_candidate_text := v_candidate::text;
  v_candidate_sha := encode(sha256(convert_to(v_candidate_text, 'UTF8')), 'hex');
  BEGIN
    v_candidate := jsonb_set(v_candidate, '{evidence,lock,selectedOwnedCoreId}',
      to_jsonb('owned-2'::text));
    PERFORM dna.publish_open_race_observation_comparison(
      dna.current_owner_id(), 'request-observation', v_old_sha, 'session-locked',
      '2020-10-16T05:05:00Z',
      encode(sha256(convert_to(v_candidate::text, 'UTF8')), 'hex'), v_candidate::text);
    RAISE EXCEPTION 'mutated Open Race lock accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'mutated Open Race lock accepted' THEN RAISE; END IF;
  END;

  v_candidate := jsonb_set(v_candidate, '{evidence,lock,selectedOwnedCoreId}',
    to_jsonb('owned-1'::text));
  v_candidate_text := v_candidate::text;
  v_candidate_sha := encode(sha256(convert_to(v_candidate_text, 'UTF8')), 'hex');
  SELECT dna.publish_open_race_observation_comparison(
    dna.current_owner_id(), 'request-observation', v_old_sha, 'session-locked',
    '2020-10-16T05:05:00Z', v_candidate_sha, v_candidate_text)
  INTO v_result;
  IF v_result <> 'published' THEN
    RAISE EXCEPTION 'Open Race observation was not published';
  END IF;

  SELECT dna.publish_open_race_observation_comparison(
    dna.current_owner_id(), 'request-observation', v_candidate_sha, 'session-observed',
    '2020-10-16T05:05:00Z', v_candidate_sha, v_candidate_text)
  INTO v_result;
  IF v_result <> 'unchanged' THEN
    RAISE EXCEPTION 'Open Race observation replay was not idempotent';
  END IF;

  SELECT dna.publish_open_race_observation_comparison(
    dna.current_owner_id(), 'request-observation', v_old_sha, 'session-locked',
    '2020-10-16T05:05:00Z', v_candidate_sha, v_candidate_text)
  INTO v_result;
  IF v_result <> 'source_changed' THEN
    RAISE EXCEPTION 'stale Open Race observation did not fail closed';
  END IF;

  BEGIN
    PERFORM dna.publish_open_race_observation_comparison(
      '91350000-0000-4000-8000-000000000002', 'request-observation',
      v_candidate_sha, 'session-observed', '2020-10-16T05:05:00Z',
      v_candidate_sha, v_candidate_text);
    RAISE EXCEPTION 'cross-owner Open Race observation accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-owner Open Race observation accepted' THEN RAISE; END IF;
  END;
END
$runtime$;
RESET ROLE;

DO $post$
DECLARE v_snapshot jsonb;
BEGIN
  SELECT snapshot_json::jsonb INTO v_snapshot
  FROM dna.open_race_workspace_session_snapshot
  WHERE owner_id = '91350000-0000-4000-8000-000000000001'
    AND request_id = 'request-observation';
  IF (v_snapshot -> 'evidence' -> 'bindings' ->> 'sessionVersion') <> 'session-observed'
    OR (v_snapshot -> 'evidence' -> 'bindings' ->> 'lockVersion') <> 'lock-v1'
    OR (v_snapshot -> 'evidence' -> 'observation' ->> 'observationId') <> 'observation-v1'
    OR (v_snapshot -> 'evidence' -> 'comparison' ->> 'comparisonId') <> 'comparison-v1'
  THEN
    RAISE EXCEPTION 'Open Race observation publication state mismatch';
  END IF;
END
$post$;

ROLLBACK;

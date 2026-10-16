BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91340000-0000-4000-8000-000000000001', 'smoke_open_race_lock_owner'),
  ('91340000-0000-4000-8000-000000000002', 'smoke_open_race_lock_other');

WITH fixture AS (
  SELECT jsonb_build_object(
    'version', 1,
    'databaseOwnerId', '91340000-0000-4000-8000-000000000001',
    'publishedAt', '2026-10-16T04:30:00.000Z',
    'evidence', jsonb_build_object(
      'bindings', jsonb_build_object(
        'sessionVersion', 'session-v1',
        'fieldVersion', 'field-v1',
        'eligibilityVersion', 'eligibility-v1',
        'historicalAggregateVersion', 'aggregate-v1',
        'raceImportVersion', 'race-v1',
        'vaultSnapshotVersion', 'vault-v1',
        'rankingVersion', 'ranking-v1',
        'lockVersion', NULL,
        'observationVersion', NULL,
        'comparisonVersion', NULL),
      'field', jsonb_build_object(
        'requestId', 'request-lock',
        'capturedAt', '2026-10-16T04:00:00.000Z',
        'mode', 'horse',
        'distanceMeters', 1600,
        'gateCount', 4,
        'opponentCoreIds', jsonb_build_array(
          'opponent-1','opponent-2','opponent-3')),
      'eligibility', jsonb_build_object('evaluationId', 'eligibility-v1'),
      'ranking', jsonb_build_object(
        'rankingId', 'ranking-v1',
        'evaluatedAt', '2026-10-16T04:10:00.000Z',
        'candidates', jsonb_build_array(
          jsonb_build_object('coreId', 'owned-1'))),
      'lock', NULL,
      'observation', NULL,
      'comparison', NULL))::text AS body
)
INSERT INTO dna.open_race_workspace_session_snapshot (
  owner_id, request_id, session_version, field_version, eligibility_version,
  race_import_version, vault_snapshot_version, historical_aggregate_version,
  mode, distance_meters, field_captured_at, latest_accepted_race_import_at,
  latest_accepted_vault_import_at, published_at, snapshot_sha256, snapshot_json)
SELECT '91340000-0000-4000-8000-000000000001', 'request-lock',
  'session-v1', 'field-v1', 'eligibility-v1', 'race-v1', 'vault-v1',
  'aggregate-v1', 'horse', 1600, '2026-10-16T04:00:00Z',
  '2026-10-16T03:00:00Z', '2026-10-16T03:00:00Z',
  '2026-10-16T04:30:00Z',
  encode(sha256(convert_to(body, 'UTF8')), 'hex'), body
FROM fixture;

DO $checks$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.publish_open_race_field_lock(uuid,text,text,text,timestamp with time zone,text,text)',
    'EXECUTE')
  THEN
    RAISE EXCEPTION 'runtime Open Race field lock publication permission missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
    WHERE p.oid = 'dna.publish_open_race_field_lock(uuid,text,text,text,timestamp with time zone,text,text)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
  THEN
    RAISE EXCEPTION 'public Open Race field lock publication permission present';
  END IF;
  IF NOT (
    SELECT prosecdef AND provolatile = 'v'
      AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    FROM pg_proc
    WHERE oid = 'dna.publish_open_race_field_lock(uuid,text,text,text,timestamp with time zone,text,text)'::regprocedure)
  THEN
    RAISE EXCEPTION 'Open Race field lock publication function configuration unsafe';
  END IF;
END
$checks$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91340000-0000-4000-8000-000000000001';
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
    to_jsonb('2026-10-16T04:45:00.000Z'::text));
  v_candidate := jsonb_set(v_candidate,
    '{evidence,bindings,sessionVersion}', to_jsonb('session-bad'::text));
  v_candidate := jsonb_set(v_candidate,
    '{evidence,bindings,lockVersion}', to_jsonb('lock-v1'::text));
  v_candidate := jsonb_set(v_candidate, '{evidence,field,distanceMeters}', '1200'::jsonb);
  v_candidate := jsonb_set(v_candidate, '{evidence,lock}', jsonb_build_object(
    'lockId', 'lock-1',
    'requestId', 'request-lock',
    'preEntryRankingId', 'ranking-v1',
    'fieldCapturedAt', '2026-10-16T04:00:00.000Z',
    'rankingEvaluatedAt', '2026-10-16T04:10:00.000Z',
    'lockedAt', '2026-10-16T04:45:00.000Z',
    'fieldStage', 'forming',
    'gateCount', 4,
    'availableGates', 0,
    'enteredCoreIds', jsonb_build_array('owned-1','opponent-1','opponent-2','opponent-3'),
    'selectedOwnedCoreId', 'owned-1',
    'provisionalRecommendedCoreId', 'owned-1',
    'preEntryStatus', 'provisional',
    'userConfirmedCommittedEntry', true,
    'allGatesFilled', true,
    'raceSetToRun', true));
  v_candidate_text := v_candidate::text;
  v_candidate_sha := encode(sha256(convert_to(v_candidate_text, 'UTF8')), 'hex');
  BEGIN
    PERFORM dna.publish_open_race_field_lock(
      dna.current_owner_id(), 'request-lock', v_old_sha, 'session-v1',
      '2026-10-16T04:45:00Z', v_candidate_sha, v_candidate_text);
    RAISE EXCEPTION 'mutated Stage A evidence accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'mutated Stage A evidence accepted' THEN RAISE; END IF;
  END;

  v_candidate := jsonb_set(v_old_text::jsonb, '{publishedAt}',
    to_jsonb('2026-10-16T05:00:00.000Z'::text));
  v_candidate := jsonb_set(v_candidate,
    '{evidence,bindings,sessionVersion}', to_jsonb('session-v2'::text));
  v_candidate := jsonb_set(v_candidate,
    '{evidence,bindings,lockVersion}', to_jsonb('lock-v1'::text));
  v_candidate := jsonb_set(v_candidate, '{evidence,lock}', jsonb_build_object(
    'lockId', 'lock-1',
    'requestId', 'request-lock',
    'preEntryRankingId', 'ranking-v1',
    'fieldCapturedAt', '2026-10-16T04:00:00.000Z',
    'rankingEvaluatedAt', '2026-10-16T04:10:00.000Z',
    'lockedAt', '2026-10-16T05:00:00.000Z',
    'fieldStage', 'forming',
    'gateCount', 4,
    'availableGates', 0,
    'enteredCoreIds', jsonb_build_array('owned-1','opponent-1','opponent-2','opponent-3'),
    'selectedOwnedCoreId', 'owned-1',
    'provisionalRecommendedCoreId', 'owned-1',
    'preEntryStatus', 'provisional',
    'userConfirmedCommittedEntry', true,
    'allGatesFilled', true,
    'raceSetToRun', true));
  v_candidate_text := v_candidate::text;
  v_candidate_sha := encode(sha256(convert_to(v_candidate_text, 'UTF8')), 'hex');

  BEGIN
    v_candidate := jsonb_set(v_candidate, '{evidence,lock,enteredCoreIds}',
      jsonb_build_array('owned-1','opponent-1','opponent-1','opponent-3'));
    v_candidate_text := v_candidate::text;
    v_candidate_sha := encode(sha256(convert_to(v_candidate_text, 'UTF8')), 'hex');
    PERFORM dna.publish_open_race_field_lock(
      dna.current_owner_id(), 'request-lock', v_old_sha, 'session-v1',
      '2026-10-16T05:00:00Z', v_candidate_sha, v_candidate_text);
    RAISE EXCEPTION 'duplicate locked field entrant accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'duplicate locked field entrant accepted' THEN RAISE; END IF;
  END;

  v_candidate := jsonb_set(v_candidate, '{evidence,lock,enteredCoreIds}',
    jsonb_build_array('owned-1','opponent-1','opponent-2','opponent-3'));
  v_candidate_text := v_candidate::text;
  v_candidate_sha := encode(sha256(convert_to(v_candidate_text, 'UTF8')), 'hex');

  SELECT dna.publish_open_race_field_lock(
    dna.current_owner_id(), 'request-lock', v_old_sha, 'session-v1',
    '2026-10-16T05:00:00Z', v_candidate_sha, v_candidate_text)
  INTO v_result;
  IF v_result <> 'published' THEN
    RAISE EXCEPTION 'Open Race field lock was not published';
  END IF;

  SELECT dna.publish_open_race_field_lock(
    dna.current_owner_id(), 'request-lock', v_candidate_sha, 'session-v2',
    '2026-10-16T05:00:00Z', v_candidate_sha, v_candidate_text)
  INTO v_result;
  IF v_result <> 'unchanged' THEN
    RAISE EXCEPTION 'Open Race field lock replay was not idempotent';
  END IF;

  SELECT dna.publish_open_race_field_lock(
    dna.current_owner_id(), 'request-lock', v_old_sha, 'session-v1',
    '2026-10-16T05:00:00Z', v_candidate_sha, v_candidate_text)
  INTO v_result;
  IF v_result <> 'source_changed' THEN
    RAISE EXCEPTION 'stale Open Race field lock did not fail closed';
  END IF;

  BEGIN
    PERFORM dna.publish_open_race_field_lock(
      '91340000-0000-4000-8000-000000000002', 'request-lock',
      v_candidate_sha, 'session-v2', '2026-10-16T05:00:00Z',
      v_candidate_sha, v_candidate_text);
    RAISE EXCEPTION 'cross-owner Open Race field lock accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-owner Open Race field lock accepted' THEN RAISE; END IF;
  END;
END
$runtime$;
RESET ROLE;

DO $post$
DECLARE v_snapshot jsonb;
BEGIN
  SELECT snapshot_json::jsonb INTO v_snapshot
  FROM dna.open_race_workspace_session_snapshot
  WHERE owner_id = '91340000-0000-4000-8000-000000000001'
    AND request_id = 'request-lock';
  IF (v_snapshot -> 'evidence' -> 'bindings' ->> 'sessionVersion') <> 'session-v2'
    OR (v_snapshot -> 'evidence' -> 'bindings' ->> 'lockVersion') <> 'lock-v1'
    OR (v_snapshot -> 'evidence' -> 'field' ->> 'distanceMeters')::integer <> 1600
  THEN
    RAISE EXCEPTION 'published Open Race field lock snapshot is invalid';
  END IF;
END
$post$;

ROLLBACK;

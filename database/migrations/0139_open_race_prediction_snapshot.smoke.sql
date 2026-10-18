BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91390000-0000-4000-8000-000000000001', 'smoke_prediction_owner'),
  ('91390000-0000-4000-8000-000000000002', 'smoke_prediction_other');

WITH fixture AS (
  SELECT jsonb_build_object(
    'version', 1,
    'databaseOwnerId', '91390000-0000-4000-8000-000000000001',
    'publishedAt', '2026-10-17T04:30:00.000Z',
    'evidence', jsonb_build_object(
      'bindings', jsonb_build_object(
        'sessionVersion', 'session-locked-v1', 'fieldVersion', 'field-v1',
        'eligibilityVersion', 'eligibility-v1', 'historicalAggregateVersion', 'aggregate-v1',
        'raceImportVersion', 'race-v1', 'vaultSnapshotVersion', 'vault-v1',
        'rankingVersion', 'ranking-v1', 'lockVersion', 'lock-v1',
        'observationVersion', NULL, 'comparisonVersion', NULL),
      'field', jsonb_build_object(
        'requestId', 'request-prediction', 'capturedAt', '2026-10-17T04:00:00.000Z',
        'dataCurrentThrough', '2026-10-17T03:00:00.000Z', 'mode', 'horse',
        'distanceMeters', 1600, 'gateCount', 4,
        'eventStartsAt', '2026-10-17T06:00:00.000Z',
        'eventIdentity', jsonb_build_object('status', 'confirmed', 'eventId', 'event-139'),
        'probabilityContext', jsonb_build_object(
          'mode','horse','distanceMeters',1600,'competition','normal',
          'format','4-gate','gateCount',4,
          'element',jsonb_build_object('status','unknown','value',NULL))),
      'eligibility', jsonb_build_object('evaluationId', 'eligibility-v1'),
      'ranking', jsonb_build_object('rankingId', 'ranking-v1'),
      'lock', jsonb_build_object(
        'lockId', 'lock-v1', 'lockedAt', '2026-10-17T04:30:00.000Z',
        'selectedOwnedCoreId', 'owned-1',
        'enteredCoreIds', jsonb_build_array('owned-1','opponent-1','opponent-2','opponent-3')),
      'observation', NULL, 'comparison', NULL))::text AS body
)
INSERT INTO dna.open_race_workspace_session_snapshot (
  owner_id, request_id, session_version, field_version, eligibility_version,
  race_import_version, vault_snapshot_version, historical_aggregate_version,
  mode, distance_meters, field_captured_at, latest_accepted_race_import_at,
  latest_accepted_vault_import_at, published_at, snapshot_sha256, snapshot_json)
SELECT '91390000-0000-4000-8000-000000000001', 'request-prediction',
  'session-locked-v1', 'field-v1', 'eligibility-v1', 'race-v1', 'vault-v1',
  'aggregate-v1', 'horse', 1600, '2026-10-17T04:00:00Z',
  '2026-10-17T03:00:00Z', '2026-10-17T03:00:00Z', '2026-10-17T04:30:00Z',
  encode(sha256(convert_to(body, 'UTF8')), 'hex'), body FROM fixture;

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.open_race_prediction_snapshot', 'SELECT')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_open_race_prediction_snapshots(uuid,integer)', 'EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.publish_open_race_prediction_snapshot(uuid,text,text,text,text)', 'EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
      WHERE p.oid IN (
        'dna.read_open_race_prediction_snapshots(uuid,integer)'::regprocedure,
        'dna.publish_open_race_prediction_snapshot(uuid,text,text,text,text)'::regprocedure)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
  THEN RAISE EXCEPTION 'Open Race prediction permissions are unsafe'; END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'dna.open_race_prediction_snapshot'::regclass)
  THEN RAISE EXCEPTION 'Open Race prediction owner isolation missing'; END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91390000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE
  v_workspace_sha text;
  v_snapshot jsonb;
  v_envelope text;
  v_sha text;
  v_result text;
BEGIN
  SELECT snapshot_sha256 INTO v_workspace_sha
  FROM dna.read_open_race_workspace_sessions(dna.current_owner_id(), 1);
  v_snapshot := jsonb_build_object(
    'snapshotId', 'prediction-event-139-v1', 'eventId', 'event-139',
    'predictedAt', '2026-10-17T05:00:00.000Z',
    'eventStartsAt', '2026-10-17T06:00:00.000Z',
    'evidenceCutoff', '2026-10-17T03:00:00.000Z', 'modelVersion', 'model-v1',
    'context', jsonb_build_object('mode','horse','distanceMeters',1600,
      'competition','normal','format','4-gate','gateCount',4,
      'element',jsonb_build_object('status','unknown','value',NULL)),
    'field', jsonb_build_object('fieldVersion','field-v1',
      'fieldCapturedAt','2026-10-17T04:00:00.000Z',
      'enteredCoreIds',jsonb_build_array('owned-1','opponent-1','opponent-2','opponent-3')),
    'sources', jsonb_build_object(
      'sessionVersion','session-locked-v1','eligibilityVersion','eligibility-v1',
      'raceImportVersion','race-v1','vaultSnapshotVersion','vault-v1',
      'historicalAggregateVersion','aggregate-v1','historyGenerationVersion','history-v1',
      'historySourceIdentitySha256',repeat('a',64),'lockVersion','lock-v1'),
    'predictions', jsonb_build_array(
      jsonb_build_object('coreId','owned-1','target','win','status','available','probabilityMillionths',500000,'evidenceStatus','complete','calculationId','win-v1'),
      jsonb_build_object('coreId','owned-1','target','place','status','available','probabilityMillionths',700000,'evidenceStatus','complete','calculationId','place-v1'),
      jsonb_build_object('coreId','owned-1','target','blue_star','status','unavailable','probabilityMillionths',NULL,'evidenceStatus','insufficient','calculationId',NULL),
      jsonb_build_object('coreId','owned-1','target','yellow_star','status','unavailable','probabilityMillionths',NULL,'evidenceStatus','insufficient','calculationId',NULL)),
    'frozen',true,'predictionMutationAllowed',false,'sameEventEvidenceIncluded',false,
    'observedOutcomeIncluded',false,'fairExOddsIncluded',false,'reconciliationStatus','pending');
  v_envelope := jsonb_build_object('version',1,
    'databaseOwnerId','91390000-0000-4000-8000-000000000001',
    'requestId','request-prediction','publishedAt','2026-10-17T05:01:00.000Z',
    'snapshot',v_snapshot)::text;
  v_sha := encode(sha256(convert_to(v_envelope, 'UTF8')), 'hex');

  SELECT dna.publish_open_race_prediction_snapshot(dna.current_owner_id(),
    'request-prediction',v_workspace_sha,v_sha,v_envelope) INTO v_result;
  IF v_result <> 'published' THEN RAISE EXCEPTION 'prediction was not published'; END IF;
  SELECT dna.publish_open_race_prediction_snapshot(dna.current_owner_id(),
    'request-prediction',v_workspace_sha,v_sha,v_envelope) INTO v_result;
  IF v_result <> 'unchanged' THEN RAISE EXCEPTION 'prediction replay was not idempotent'; END IF;
  IF (SELECT count(*) FROM dna.read_open_race_prediction_snapshots(dna.current_owner_id(), 24)) <> 1
  THEN RAISE EXCEPTION 'prediction read is not exact'; END IF;

  BEGIN
    PERFORM dna.publish_open_race_prediction_snapshot(
      '91390000-0000-4000-8000-000000000002','request-prediction',
      v_workspace_sha,v_sha,v_envelope);
    RAISE EXCEPTION 'cross-owner prediction accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-owner prediction accepted' THEN RAISE; END IF;
  END;

  v_snapshot := jsonb_set(v_snapshot, '{sources,vaultSnapshotVersion}', to_jsonb('vault-forged'::text));
  v_envelope := jsonb_set(v_envelope::jsonb, '{snapshot}', v_snapshot)::text;
  v_sha := encode(sha256(convert_to(v_envelope, 'UTF8')), 'hex');
  BEGIN
    PERFORM dna.publish_open_race_prediction_snapshot(dna.current_owner_id(),
      'request-prediction',v_workspace_sha,v_sha,v_envelope);
    RAISE EXCEPTION 'forged prediction source accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'forged prediction source accepted' THEN RAISE; END IF;
  END;
END
$runtime$;
RESET ROLE;

ROLLBACK;

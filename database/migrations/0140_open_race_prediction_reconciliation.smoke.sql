BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91400000-0000-4000-8000-000000000001', 'smoke_reconciliation_owner'),
  ('91400000-0000-4000-8000-000000000002', 'smoke_reconciliation_other');

WITH fixture AS (
  SELECT jsonb_build_object(
    'version', 1,
    'databaseOwnerId', '91400000-0000-4000-8000-000000000001',
    'requestId', 'request-reconciliation',
    'publishedAt', '2026-10-17T05:01:00.000Z',
    'snapshot', jsonb_build_object(
      'snapshotId', 'prediction-event-140-v1', 'eventId', 'event-140',
      'predictedAt', '2026-10-17T05:00:00.000Z',
      'eventStartsAt', '2026-10-17T06:00:00.000Z',
      'evidenceCutoff', '2026-10-17T03:00:00.000Z', 'modelVersion', 'model-v1',
      'context', jsonb_build_object('gateCount',1),
      'field', jsonb_build_object('fieldVersion','field-v1',
        'enteredCoreIds',jsonb_build_array('owned-1')),
      'sources', jsonb_build_object(
        'sessionVersion','session-v1','eligibilityVersion','eligibility-v1',
        'lockVersion','lock-v1','raceImportVersion','race-v1',
        'vaultSnapshotVersion','vault-v1','historicalAggregateVersion','aggregate-v1',
        'historyGenerationVersion','history-v1',
        'historySourceIdentitySha256',repeat('a',64)),
      'predictions',jsonb_build_array(
        jsonb_build_object('coreId','owned-1','target','win','status','available',
          'probabilityMillionths',500000,'evidenceStatus','complete','calculationId','win-v1'))))::text AS body
)
INSERT INTO dna.open_race_prediction_snapshot (
  owner_id, snapshot_id, request_id, event_id, predicted_at, event_starts_at,
  evidence_cutoff, model_version, session_version, field_version,
  eligibility_version, lock_version, race_import_version, vault_snapshot_version,
  historical_aggregate_version, history_generation_version,
  history_source_identity_sha256, published_at, snapshot_sha256, snapshot_json)
SELECT '91400000-0000-4000-8000-000000000001', 'prediction-event-140-v1',
  'request-reconciliation', 'event-140', '2026-10-17T05:00:00Z',
  '2026-10-17T06:00:00Z', '2026-10-17T03:00:00Z', 'model-v1',
  'session-v1', 'field-v1', 'eligibility-v1', 'lock-v1', 'race-v1',
  'vault-v1', 'aggregate-v1', 'history-v1', repeat('a',64),
  '2026-10-17T05:01:00Z', encode(sha256(convert_to(body,'UTF8')),'hex'), body
FROM fixture;

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime',
      'dna.open_race_prediction_reconciliation', 'SELECT')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_open_race_prediction_reconciliations(uuid,integer)', 'EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.publish_open_race_prediction_reconciliation(uuid,text,text,text)', 'EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
      WHERE p.oid IN (
        'dna.read_open_race_prediction_reconciliations(uuid,integer)'::regprocedure,
        'dna.publish_open_race_prediction_reconciliation(uuid,text,text,text)'::regprocedure)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
  THEN RAISE EXCEPTION 'Open Race prediction reconciliation permissions are unsafe'; END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'dna.open_race_prediction_reconciliation'::regclass)
  THEN RAISE EXCEPTION 'Open Race prediction reconciliation owner isolation missing'; END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91400000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE
  v_snapshot_sha text;
  v_snapshot_before text;
  v_reconciliation jsonb;
  v_envelope text;
  v_sha text;
  v_result text;
BEGIN
  SELECT snapshot_sha256, snapshot_json INTO v_snapshot_sha, v_snapshot_before
  FROM dna.read_open_race_prediction_snapshots(dna.current_owner_id(), 1);
  v_reconciliation := jsonb_build_object(
    'reconciliationId','reconciliation-event-140','snapshotId','prediction-event-140-v1',
    'eventId','event-140','sourceEvidenceId','accepted-event-140-v1',
    'sourceVersion','race-import-v2','acceptedAt','2026-10-17T06:03:00.000Z',
    'eventCompletedAt','2026-10-17T06:02:00.000Z','outcomeStatus','complete',
    'starDataStatus','complete','entries',jsonb_build_array(
      jsonb_build_object('coreId','owned-1','finishPosition',1,'goldStar',true,'blueStar',true)),
    'scores',jsonb_build_array(
      jsonb_build_object('coreId','owned-1','target','win','predictionProbabilityMillionths',500000,
        'actual',true,'scoringStatus','scored','reason','prediction_available')),
    'recordStatus','reconciled','issues','[]'::jsonb,'revision',0,
    'correctsSourceEvidenceId',NULL,'correctionHistory','[]'::jsonb,
    'frozenPredictionMutated',false,'historyUpdateAllowed',true);
  v_envelope := jsonb_build_object('version',1,
    'databaseOwnerId','91400000-0000-4000-8000-000000000001',
    'publishedAt','2026-10-17T06:04:00.000Z','reconciliation',v_reconciliation)::text;
  v_sha := encode(sha256(convert_to(v_envelope,'UTF8')),'hex');

  SELECT dna.publish_open_race_prediction_reconciliation(dna.current_owner_id(),
    v_snapshot_sha,v_sha,v_envelope) INTO v_result;
  IF v_result <> 'published' THEN RAISE EXCEPTION 'reconciliation was not published'; END IF;
  SELECT dna.publish_open_race_prediction_reconciliation(dna.current_owner_id(),
    v_snapshot_sha,v_sha,v_envelope) INTO v_result;
  IF v_result <> 'unchanged' THEN RAISE EXCEPTION 'reconciliation replay was not idempotent'; END IF;

  v_reconciliation := jsonb_set(v_reconciliation,'{sourceEvidenceId}',
    to_jsonb('accepted-event-140-v2'::text));
  v_reconciliation := jsonb_set(v_reconciliation,'{sourceVersion}',
    to_jsonb('race-import-v3'::text));
  v_reconciliation := jsonb_set(v_reconciliation,'{acceptedAt}',
    to_jsonb('2026-10-17T07:03:00.000Z'::text));
  v_reconciliation := jsonb_set(v_reconciliation,'{revision}','1'::jsonb);
  v_reconciliation := jsonb_set(v_reconciliation,'{correctsSourceEvidenceId}',
    to_jsonb('accepted-event-140-v1'::text));
  v_reconciliation := jsonb_set(v_reconciliation,'{correctionHistory}',jsonb_build_array(
    jsonb_build_object('revision',0,'sourceEvidenceId','accepted-event-140-v1',
      'sourceVersion','race-import-v2','acceptedAt','2026-10-17T06:03:00.000Z')));
  v_envelope := jsonb_build_object('version',1,
    'databaseOwnerId','91400000-0000-4000-8000-000000000001',
    'publishedAt','2026-10-17T07:04:00.000Z','reconciliation',v_reconciliation)::text;
  v_sha := encode(sha256(convert_to(v_envelope,'UTF8')),'hex');
  SELECT dna.publish_open_race_prediction_reconciliation(dna.current_owner_id(),
    v_snapshot_sha,v_sha,v_envelope) INTO v_result;
  IF v_result <> 'published' THEN RAISE EXCEPTION 'correction was not appended'; END IF;
  IF (SELECT count(*) FROM dna.read_open_race_prediction_reconciliations(
      dna.current_owner_id(),48)) <> 2
  THEN RAISE EXCEPTION 'reconciliation history is not exact'; END IF;
  IF (SELECT snapshot_json FROM dna.read_open_race_prediction_snapshots(
      dna.current_owner_id(),1)) IS DISTINCT FROM v_snapshot_before
  THEN RAISE EXCEPTION 'frozen prediction was mutated'; END IF;

  BEGIN
    PERFORM dna.publish_open_race_prediction_reconciliation(
      '91400000-0000-4000-8000-000000000002',v_snapshot_sha,v_sha,v_envelope);
    RAISE EXCEPTION 'cross-owner reconciliation accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-owner reconciliation accepted' THEN RAISE; END IF;
  END;
END
$runtime$;
RESET ROLE;

ROLLBACK;

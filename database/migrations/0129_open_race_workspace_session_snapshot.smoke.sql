BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91290000-0000-4000-8000-000000000001', 'smoke_open_race_owner'),
  ('91290000-0000-4000-8000-000000000002', 'smoke_open_race_other');

WITH fixture AS (
  SELECT id AS owner_id,
    ('request-' || right(id::text, 1)) AS request_id,
    jsonb_build_object(
      'version',1,
      'databaseOwnerId',id::text,
      'publishedAt','2026-10-16T04:30:00.000Z',
      'evidence',jsonb_build_object(
        'bindings',jsonb_build_object(
          'sessionVersion','session-v1','fieldVersion','field-v1',
          'eligibilityVersion','eligibility-v1',
          'historicalAggregateVersion','aggregate-v1',
          'raceImportVersion','race-v1','vaultSnapshotVersion','vault-v1',
          'rankingVersion',NULL,'lockVersion',NULL,
          'observationVersion',NULL,'comparisonVersion',NULL),
        'field',jsonb_build_object(
          'requestId',('request-' || right(id::text, 1)),
          'capturedAt','2026-10-16T04:00:00.000Z',
          'mode','horse','distanceMeters',1600),
        'eligibility',jsonb_build_object(),
        'ranking',NULL,'lock',NULL,'observation',NULL,'comparison',NULL))::text AS body
  FROM dna.app_owner
  WHERE id IN ('91290000-0000-4000-8000-000000000001','91290000-0000-4000-8000-000000000002')
)
INSERT INTO dna.open_race_workspace_session_snapshot (
  owner_id,request_id,session_version,field_version,eligibility_version,
  race_import_version,vault_snapshot_version,historical_aggregate_version,
  mode,distance_meters,field_captured_at,latest_accepted_race_import_at,
  latest_accepted_vault_import_at,published_at,snapshot_sha256,snapshot_json)
SELECT owner_id,request_id,'session-v1','field-v1','eligibility-v1',
  'race-v1','vault-v1','aggregate-v1','horse',1600,
  '2026-10-16T04:00:00Z','2026-10-16T03:00:00Z',
  '2026-10-16T03:00:00Z','2026-10-16T04:30:00Z',
  encode(sha256(convert_to(body,'UTF8')),'hex'),body
FROM fixture;

DO $checks$
DECLARE v_privilege text; v_rls boolean; v_force boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
  FROM pg_class WHERE oid='dna.open_race_workspace_session_snapshot'::regclass;
  IF NOT v_rls OR NOT v_force THEN
    RAISE EXCEPTION 'forced Open Race workspace isolation missing';
  END IF;
  FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('dna_app_runtime','dna.open_race_workspace_session_snapshot',v_privilege) THEN
      RAISE EXCEPTION 'runtime Open Race workspace table privilege unexpectedly present';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime','dna.read_open_race_workspace_sessions(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'runtime Open Race workspace read permission missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
    WHERE p.oid='dna.read_open_race_workspace_sessions(uuid,integer)'::regprocedure
      AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'public Open Race workspace read permission present';
  END IF;
  IF NOT (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    FROM pg_proc WHERE oid='dna.read_open_race_workspace_sessions(uuid,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'Open Race workspace function configuration unsafe';
  END IF;
  BEGIN
    UPDATE dna.open_race_workspace_session_snapshot SET mode='bike'
      WHERE owner_id='91290000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'mismatched Open Race mode accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.open_race_workspace_session_snapshot SET distance_meters=1200
      WHERE owner_id='91290000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'mismatched Open Race distance accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.open_race_workspace_session_snapshot SET snapshot_sha256=repeat('b',64)
      WHERE owner_id='91290000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'bad Open Race checksum accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT count(*) FROM dna.open_race_workspace_session_snapshot)<>2 THEN
    RAISE EXCEPTION 'rejected Open Race mutations changed stored rows';
  END IF;
END
$checks$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91290000-0000-4000-8000-000000000001';
DO $runtime$
BEGIN
  IF (SELECT count(*) FROM dna.read_open_race_workspace_sessions(dna.current_owner_id(),24))<>1 THEN
    RAISE EXCEPTION 'owner Open Race workspace read failed';
  END IF;
  BEGIN
    PERFORM * FROM dna.read_open_race_workspace_sessions('91290000-0000-4000-8000-000000000002',24);
    RAISE EXCEPTION 'cross-owner Open Race workspace read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner Open Race workspace read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.read_open_race_workspace_sessions(dna.current_owner_id(),25);
    RAISE EXCEPTION 'unbounded Open Race workspace read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='unbounded Open Race workspace read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.open_race_workspace_session_snapshot;
    RAISE EXCEPTION 'direct runtime Open Race workspace read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
RESET ROLE;

CREATE ROLE dna_ci_open_race_rls NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA dna TO dna_ci_open_race_rls;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_open_race_rls;
ALTER TABLE dna.open_race_workspace_session_snapshot OWNER TO dna_ci_open_race_rls;
SET LOCAL ROLE dna_ci_open_race_rls;
SET LOCAL app.owner_id = '91290000-0000-4000-8000-000000000001';
DO $rls$
BEGIN
  IF (SELECT count(*) FROM dna.open_race_workspace_session_snapshot)<>1 THEN
    RAISE EXCEPTION 'forced Open Race workspace RLS failed for table owner';
  END IF;
  BEGIN
    UPDATE dna.open_race_workspace_session_snapshot
      SET owner_id='91290000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'cross-owner Open Race workspace mutation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$rls$;
RESET ROLE;
ROLLBACK;

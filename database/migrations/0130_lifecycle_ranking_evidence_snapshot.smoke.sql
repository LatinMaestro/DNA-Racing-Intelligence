BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91300000-0000-4000-8000-000000000001', 'smoke_lifecycle_owner'),
  ('91300000-0000-4000-8000-000000000002', 'smoke_lifecycle_other');

INSERT INTO dna.lifecycle_ranking_evidence_snapshot (
  owner_id, ranking_id, configuration_version, candidate_snapshot_version,
  racing_snapshot_version, discovery_snapshot_version, maiden_snapshot_version,
  breeding_snapshot_version, lineage_snapshot_version, market_snapshot_version,
  data_current_through, latest_accepted_import_at, evaluated_at, published_at,
  snapshot_sha256, snapshot_json
)
SELECT owner_id, 'ranking-v1', 'config-v1', 'candidate-v1', 'racing-v1',
  'discovery-v1', 'maiden-v1', 'breeding-v1', 'lineage-v1', 'market-v1',
  '2026-10-15T00:00:00Z', '2026-10-15T01:00:00Z',
  '2026-10-15T02:00:00Z', '2026-10-15T03:00:00Z',
  encode(sha256(convert_to(body,'UTF8')),'hex'), body
FROM (
  SELECT id AS owner_id, jsonb_build_object(
    'version',1,
    'databaseOwnerId',id::text,
    'publishedAt','2026-10-15T03:00:00.000Z',
    'latestAcceptedImportAt','2026-10-15T01:00:00.000Z',
    'ranking',jsonb_build_object(
      'rankingId','ranking-v1',
      'rankingLabel','Synthetic lifecycle review',
      'configurationVersion','config-v1',
      'candidateSnapshotVersion','candidate-v1',
      'racingSnapshotVersion','racing-v1',
      'discoverySnapshotVersion','discovery-v1',
      'maidenSnapshotVersion','maiden-v1',
      'breedingSnapshotVersion','breeding-v1',
      'lineageSnapshotVersion','lineage-v1',
      'marketSnapshotVersion','market-v1',
      'evaluatedAt','2026-10-15T02:00:00.000Z',
      'dataCurrentThrough','2026-10-15T00:00:00.000Z',
      'lastImported','2026-10-15T01:00:00.000Z',
      'freshness','current',
      'cores','[]'::jsonb
    )
  )::text AS body
  FROM dna.app_owner
  WHERE id IN (
    '91300000-0000-4000-8000-000000000001',
    '91300000-0000-4000-8000-000000000002'
  )
) fixture;

DO $checks$
DECLARE v_privilege text; v_rls boolean; v_force boolean; v_body text;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
  FROM pg_class WHERE oid='dna.lifecycle_ranking_evidence_snapshot'::regclass;
  IF NOT v_rls OR NOT v_force THEN RAISE EXCEPTION 'forced Lifecycle isolation missing'; END IF;
  FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('dna_app_runtime','dna.lifecycle_ranking_evidence_snapshot',v_privilege) THEN
      RAISE EXCEPTION 'runtime Lifecycle table privilege unexpectedly present';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime','dna.read_lifecycle_ranking_evidence_snapshot(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'runtime Lifecycle function permission missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
    WHERE p.oid='dna.read_lifecycle_ranking_evidence_snapshot(uuid)'::regprocedure
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'public Lifecycle read permission present';
  END IF;
  IF NOT (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    FROM pg_proc WHERE oid='dna.read_lifecycle_ranking_evidence_snapshot(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'Lifecycle function configuration unsafe';
  END IF;
  BEGIN
    UPDATE dna.lifecycle_ranking_evidence_snapshot SET snapshot_sha256=repeat('b',64);
    RAISE EXCEPTION 'bad Lifecycle checksum accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.lifecycle_ranking_evidence_snapshot SET configuration_version='config-v2';
    RAISE EXCEPTION 'mismatched Lifecycle source version accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.lifecycle_ranking_evidence_snapshot SET latest_accepted_import_at='2026-10-15T04:00:00Z';
    RAISE EXCEPTION 'invalid Lifecycle chronology accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT (snapshot_json::jsonb || jsonb_build_object('padding',repeat('x',524289)))::text
    INTO v_body FROM dna.lifecycle_ranking_evidence_snapshot
    WHERE owner_id='91300000-0000-4000-8000-000000000001';
  BEGIN
    UPDATE dna.lifecycle_ranking_evidence_snapshot
      SET snapshot_json=v_body,
        snapshot_sha256=encode(sha256(convert_to(v_body,'UTF8')),'hex')
      WHERE owner_id='91300000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'oversized Lifecycle payload accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT count(*) FROM dna.lifecycle_ranking_evidence_snapshot)<>2 THEN
    RAISE EXCEPTION 'rejected mutations changed last stored Lifecycle rows';
  END IF;
END
$checks$;

\if :{?skip_runtime_role}
SET LOCAL app.owner_id = '91300000-0000-4000-8000-000000000001';
DO $managed_owner$
BEGIN
  IF (SELECT count(*) FROM dna.read_lifecycle_ranking_evidence_snapshot(dna.current_owner_id()))<>1 THEN
    RAISE EXCEPTION 'owner Lifecycle evidence read failed';
  END IF;
  BEGIN
    PERFORM * FROM dna.read_lifecycle_ranking_evidence_snapshot('91300000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'cross-owner Lifecycle read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner Lifecycle read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.read_lifecycle_ranking_evidence_snapshot(NULL);
    RAISE EXCEPTION 'null owner Lifecycle read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='null owner Lifecycle read accepted' THEN RAISE; END IF;
  END;
END
$managed_owner$;
SET LOCAL app.owner_id = '';
DO $managed_missing_scope$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_lifecycle_ranking_evidence_snapshot('91300000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'unscoped Lifecycle read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='unscoped Lifecycle read accepted' THEN RAISE; END IF;
  END;
END
$managed_missing_scope$;
\else
SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91300000-0000-4000-8000-000000000001';
DO $runtime$
BEGIN
  IF (SELECT count(*) FROM dna.read_lifecycle_ranking_evidence_snapshot(dna.current_owner_id()))<>1 THEN
    RAISE EXCEPTION 'owner Lifecycle evidence read failed';
  END IF;
  BEGIN
    PERFORM * FROM dna.read_lifecycle_ranking_evidence_snapshot('91300000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'cross-owner Lifecycle read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner Lifecycle read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.read_lifecycle_ranking_evidence_snapshot(NULL);
    RAISE EXCEPTION 'null owner Lifecycle read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='null owner Lifecycle read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.lifecycle_ranking_evidence_snapshot;
    RAISE EXCEPTION 'direct runtime Lifecycle read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM dna.lifecycle_ranking_evidence_snapshot;
    RAISE EXCEPTION 'direct runtime Lifecycle write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
SET LOCAL app.owner_id = '';
DO $missing_scope$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_lifecycle_ranking_evidence_snapshot('91300000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'unscoped Lifecycle read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='unscoped Lifecycle read accepted' THEN RAISE; END IF;
  END;
END
$missing_scope$;
RESET ROLE;

CREATE ROLE dna_ci_lifecycle_rls NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA dna TO dna_ci_lifecycle_rls;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_lifecycle_rls;
ALTER TABLE dna.lifecycle_ranking_evidence_snapshot OWNER TO dna_ci_lifecycle_rls;
SET LOCAL ROLE dna_ci_lifecycle_rls;
SET LOCAL app.owner_id = '91300000-0000-4000-8000-000000000001';
DO $rls$
BEGIN
  IF (SELECT count(*) FROM dna.lifecycle_ranking_evidence_snapshot)<>1 THEN
    RAISE EXCEPTION 'forced Lifecycle RLS failed for table owner';
  END IF;
  BEGIN
    UPDATE dna.lifecycle_ranking_evidence_snapshot
      SET owner_id='91300000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'cross-owner Lifecycle mutation accepted';
  EXCEPTION WHEN unique_violation OR insufficient_privilege THEN NULL; END;
END
$rls$;
RESET ROLE;
\endif
ROLLBACK;

BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91270000-0000-4000-8000-000000000001', 'smoke_maiden_owner'),
  ('91270000-0000-4000-8000-000000000002', 'smoke_maiden_other');

-- Envelope fixtures test storage/isolation only. The TypeScript adapter also
-- requires the complete canonical Maiden evidence codec before serving a row.
INSERT INTO dna.maiden_allocation_evidence_snapshot
  (owner_id, source_evidence_sha256, snapshot_sha256, materialized_at, snapshot_json)
SELECT owner_id, repeat('a',64), encode(sha256(convert_to(body,'UTF8')),'hex'),
  '2026-10-15T00:00:00Z', body
FROM (
  SELECT id AS owner_id, jsonb_build_object('version',1,
    'databaseOwnerId', id::text, 'sourceEvidenceSha256',repeat('a',64),
    'materializedAt','2026-10-15T00:00:00.000Z','evidence',
    jsonb_build_object('brackets','[]'::jsonb,'candidates','[]'::jsonb,
      'lastImportedAt',NULL))::text AS body
  FROM dna.app_owner
  WHERE id IN ('91270000-0000-4000-8000-000000000001','91270000-0000-4000-8000-000000000002')
) fixture;

DO $checks$
DECLARE v_privilege text; v_rls boolean; v_force boolean; v_body text;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
  FROM pg_class WHERE oid='dna.maiden_allocation_evidence_snapshot'::regclass;
  IF NOT v_rls OR NOT v_force THEN RAISE EXCEPTION 'forced Maiden isolation missing'; END IF;
  FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('dna_app_runtime','dna.maiden_allocation_evidence_snapshot',v_privilege) THEN
      RAISE EXCEPTION 'runtime Maiden table privilege unexpectedly present';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime','dna.read_maiden_allocation_evidence_snapshot(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'runtime Maiden function permission missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
    WHERE p.oid='dna.read_maiden_allocation_evidence_snapshot(uuid)'::regprocedure
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'public Maiden read permission present';
  END IF;
  IF NOT (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    FROM pg_proc WHERE oid='dna.read_maiden_allocation_evidence_snapshot(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'Maiden function configuration unsafe';
  END IF;
  BEGIN
    UPDATE dna.maiden_allocation_evidence_snapshot SET snapshot_sha256=repeat('b',64);
    RAISE EXCEPTION 'bad Maiden checksum accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.maiden_allocation_evidence_snapshot SET source_evidence_sha256=repeat('b',64);
    RAISE EXCEPTION 'mismatched Maiden source accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.maiden_allocation_evidence_snapshot SET materialized_at='2026-10-16T00:00:00Z';
    RAISE EXCEPTION 'mismatched Maiden timestamp accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT (snapshot_json::jsonb || jsonb_build_object('padding',repeat('x',524289)))::text
    INTO v_body FROM dna.maiden_allocation_evidence_snapshot
    WHERE owner_id='91270000-0000-4000-8000-000000000001';
  BEGIN
    UPDATE dna.maiden_allocation_evidence_snapshot
      SET snapshot_json=v_body, snapshot_sha256=encode(sha256(convert_to(v_body,'UTF8')),'hex')
      WHERE owner_id='91270000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'oversized Maiden payload accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT count(*) FROM dna.maiden_allocation_evidence_snapshot)<>2 THEN
    RAISE EXCEPTION 'rejected mutations changed last stored Maiden rows';
  END IF;
END
$checks$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91270000-0000-4000-8000-000000000001';
DO $runtime$
BEGIN
  IF (SELECT count(*) FROM dna.read_maiden_allocation_evidence_snapshot(dna.current_owner_id()))<>1 THEN
    RAISE EXCEPTION 'owner Maiden evidence read failed';
  END IF;
  BEGIN
    PERFORM * FROM dna.read_maiden_allocation_evidence_snapshot('91270000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'cross-owner Maiden read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner Maiden read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.read_maiden_allocation_evidence_snapshot(NULL);
    RAISE EXCEPTION 'null owner Maiden read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='null owner Maiden read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.maiden_allocation_evidence_snapshot;
    RAISE EXCEPTION 'direct runtime Maiden read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM dna.maiden_allocation_evidence_snapshot;
    RAISE EXCEPTION 'direct runtime Maiden write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
SET LOCAL app.owner_id = '';
DO $missing_scope$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_maiden_allocation_evidence_snapshot('91270000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'unscoped Maiden read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='unscoped Maiden read accepted' THEN RAISE; END IF;
  END;
END
$missing_scope$;
RESET ROLE;

CREATE ROLE dna_ci_maiden_rls NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA dna TO dna_ci_maiden_rls;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_maiden_rls;
ALTER TABLE dna.maiden_allocation_evidence_snapshot OWNER TO dna_ci_maiden_rls;
SET LOCAL ROLE dna_ci_maiden_rls;
SET LOCAL app.owner_id = '91270000-0000-4000-8000-000000000001';
DO $rls$
BEGIN
  IF (SELECT count(*) FROM dna.maiden_allocation_evidence_snapshot)<>1 THEN
    RAISE EXCEPTION 'forced Maiden RLS failed for table owner';
  END IF;
  BEGIN
    UPDATE dna.maiden_allocation_evidence_snapshot SET owner_id='91270000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'cross-owner Maiden mutation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$rls$;
RESET ROLE;
ROLLBACK;

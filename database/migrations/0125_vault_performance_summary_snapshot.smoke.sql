BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91250000-0000-4000-8000-000000000001', 'smoke_summary_owner'),
  ('91250000-0000-4000-8000-000000000002', 'smoke_summary_other');

-- Envelope fixtures test storage/isolation, not financial acceptance. The TS
-- adapter must additionally accept the complete canonical codec before use.
INSERT INTO dna.vault_performance_summary_snapshot
  (owner_id, source_ledger_sha256, snapshot_sha256, materialized_at, snapshot_json)
SELECT owner_id, repeat('a',64), encode(sha256(convert_to(body,'UTF8')),'hex'),
  '2026-10-15T00:00:00Z', body
FROM (
  SELECT id AS owner_id, jsonb_build_object('version',1,
    'databaseOwnerId', id::text, 'sourceLedgerSha256',repeat('a',64),
    'materializedAt','2026-10-15T00:00:00.000Z','summary','{}'::jsonb)::text AS body
  FROM dna.app_owner
  WHERE id IN ('91250000-0000-4000-8000-000000000001','91250000-0000-4000-8000-000000000002')
) fixture;

DO $checks$
DECLARE v_privilege text; v_rls boolean; v_force boolean; v_body text;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
  FROM pg_class WHERE oid='dna.vault_performance_summary_snapshot'::regclass;
  IF NOT v_rls OR NOT v_force THEN RAISE EXCEPTION 'forced summary isolation missing'; END IF;
  FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('dna_app_runtime','dna.vault_performance_summary_snapshot',v_privilege) THEN
      RAISE EXCEPTION 'runtime summary table privilege unexpectedly present';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime','dna.read_vault_performance_summary_snapshot(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'runtime summary function permission missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
    WHERE p.oid='dna.read_vault_performance_summary_snapshot(uuid,text)'::regprocedure
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'public summary read permission present';
  END IF;
  IF NOT (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    FROM pg_proc WHERE oid='dna.read_vault_performance_summary_snapshot(uuid,text)'::regprocedure) THEN
    RAISE EXCEPTION 'summary function configuration unsafe';
  END IF;
  BEGIN
    UPDATE dna.vault_performance_summary_snapshot SET snapshot_sha256=repeat('b',64);
    RAISE EXCEPTION 'bad checksum accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.vault_performance_summary_snapshot SET source_ledger_sha256=repeat('b',64);
    RAISE EXCEPTION 'mismatched source accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.vault_performance_summary_snapshot SET materialized_at='2026-10-16T00:00:00Z';
    RAISE EXCEPTION 'mismatched timestamp accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT (snapshot_json::jsonb || jsonb_build_object('padding',repeat('x',262145)))::text
    INTO v_body FROM dna.vault_performance_summary_snapshot
    WHERE owner_id='91250000-0000-4000-8000-000000000001';
  BEGIN
    UPDATE dna.vault_performance_summary_snapshot
      SET snapshot_json=v_body, snapshot_sha256=encode(sha256(convert_to(v_body,'UTF8')),'hex')
      WHERE owner_id='91250000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'oversized payload accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT count(*) FROM dna.vault_performance_summary_snapshot)<>2 THEN
    RAISE EXCEPTION 'rejected mutations changed last stored rows';
  END IF;
END
$checks$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91250000-0000-4000-8000-000000000001';
DO $runtime$
BEGIN
  IF (SELECT count(*) FROM dna.read_vault_performance_summary_snapshot(dna.current_owner_id(),repeat('a',64)))<>1 THEN
    RAISE EXCEPTION 'owner summary read failed';
  END IF;
  IF EXISTS (SELECT 1 FROM dna.read_vault_performance_summary_snapshot(dna.current_owner_id(),repeat('b',64))) THEN
    RAISE EXCEPTION 'superseded summary was served';
  END IF;
  BEGIN
    PERFORM * FROM dna.read_vault_performance_summary_snapshot('91250000-0000-4000-8000-000000000002',repeat('a',64));
    RAISE EXCEPTION 'cross-owner summary accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner summary accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.read_vault_performance_summary_snapshot(NULL,repeat('a',64));
    RAISE EXCEPTION 'null owner summary accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='null owner summary accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.read_vault_performance_summary_snapshot(dna.current_owner_id(),NULL);
    RAISE EXCEPTION 'null source accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='null source accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.vault_performance_summary_snapshot;
    RAISE EXCEPTION 'direct runtime read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM dna.vault_performance_summary_snapshot;
    RAISE EXCEPTION 'direct runtime write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
SET LOCAL app.owner_id = '';
DO $missing_scope$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_vault_performance_summary_snapshot('91250000-0000-4000-8000-000000000001',repeat('a',64));
    RAISE EXCEPTION 'unscoped summary accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='unscoped summary accepted' THEN RAISE; END IF;
  END;
END
$missing_scope$;
RESET ROLE;

-- Prove the forced table policy as its non-bypass owner, not a superuser.
CREATE ROLE dna_ci_summary_rls NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA dna TO dna_ci_summary_rls;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_summary_rls;
ALTER TABLE dna.vault_performance_summary_snapshot OWNER TO dna_ci_summary_rls;
SET LOCAL ROLE dna_ci_summary_rls;
SET LOCAL app.owner_id = '91250000-0000-4000-8000-000000000001';
DO $rls$
BEGIN
  IF (SELECT count(*) FROM dna.vault_performance_summary_snapshot)<>1 THEN
    RAISE EXCEPTION 'forced RLS failed for table owner';
  END IF;
  BEGIN
    UPDATE dna.vault_performance_summary_snapshot SET owner_id='91250000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'cross-owner mutation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$rls$;
RESET ROLE;
ROLLBACK;

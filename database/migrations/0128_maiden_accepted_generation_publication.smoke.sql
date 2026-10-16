BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91280000-0000-4000-8000-000000000001', 'smoke_maiden_publication_owner'),
  ('91280000-0000-4000-8000-000000000002', 'smoke_maiden_publication_other');

WITH fixture AS (
  SELECT id AS owner_id,
    jsonb_build_object('methodVersion','approved-v1','correctionVersion','owner-v1')::text AS identity_json
  FROM dna.app_owner
  WHERE id IN ('91280000-0000-4000-8000-000000000001','91280000-0000-4000-8000-000000000002')
), identified AS (
  SELECT owner_id, identity_json,
    encode(sha256(convert_to(identity_json,'UTF8')),'hex') AS source_sha
  FROM fixture
)
INSERT INTO dna.maiden_allocation_accepted_generation
  (owner_id, source_evidence_sha256, source_identity_json, generation_json, accepted_at)
SELECT owner_id, source_sha, identity_json,
  jsonb_build_object('databaseOwnerId',owner_id::text,
    'sourceEvidenceSha256',source_sha,
    'coverage',jsonb_build_object('state','accepted'),
    'evidence',jsonb_build_object('brackets','[]'::jsonb,'candidates','[]'::jsonb,
      'lastImportedAt',NULL))::text,
  '2026-10-16T00:00:00Z'
FROM identified;

DO $checks$
DECLARE v_privilege text; v_rls boolean; v_force boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
  FROM pg_class WHERE oid='dna.maiden_allocation_accepted_generation'::regclass;
  IF NOT v_rls OR NOT v_force THEN
    RAISE EXCEPTION 'forced Maiden accepted generation isolation missing';
  END IF;
  FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('dna_app_runtime','dna.maiden_allocation_accepted_generation',v_privilege) THEN
      RAISE EXCEPTION 'runtime Maiden accepted generation table privilege unexpectedly present';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime','dna.read_maiden_allocation_accepted_generation(uuid)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime','dna.read_maiden_allocation_accepted_source_identity(uuid)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime','dna.publish_maiden_allocation_evidence_snapshot(uuid,text,timestamp with time zone,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'runtime Maiden publication function permission missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
    WHERE p.oid IN (
      'dna.read_maiden_allocation_accepted_generation(uuid)'::regprocedure,
      'dna.read_maiden_allocation_accepted_source_identity(uuid)'::regprocedure,
      'dna.publish_maiden_allocation_evidence_snapshot(uuid,text,timestamp with time zone,text,text)'::regprocedure)
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'public Maiden publication permission present';
  END IF;
  BEGIN
    UPDATE dna.maiden_allocation_accepted_generation
      SET source_evidence_sha256=repeat('a',64);
    RAISE EXCEPTION 'unbound Maiden source identity accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END
$checks$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91280000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE v_source text; v_body text; v_sha text; v_status text;
BEGIN
  SELECT source_evidence_sha256 INTO v_source
  FROM dna.read_maiden_allocation_accepted_source_identity(dna.current_owner_id());
  IF v_source IS NULL THEN RAISE EXCEPTION 'Maiden source identity missing'; END IF;
  IF (SELECT count(*) FROM dna.read_maiden_allocation_accepted_generation(dna.current_owner_id()))<>1 THEN
    RAISE EXCEPTION 'Maiden accepted generation read failed';
  END IF;
  v_body := jsonb_build_object('version',1,
    'databaseOwnerId',dna.current_owner_id()::text,'sourceEvidenceSha256',v_source,
    'materializedAt','2026-10-16T00:30:00.000Z','evidence',
    jsonb_build_object('brackets','[]'::jsonb,'candidates','[]'::jsonb,
      'lastImportedAt',NULL))::text;
  v_sha := encode(sha256(convert_to(v_body,'UTF8')),'hex');
  SELECT dna.publish_maiden_allocation_evidence_snapshot(dna.current_owner_id(),
    v_source,'2026-10-16T00:30:00Z',v_body,v_sha) INTO v_status;
  IF v_status<>'published' THEN RAISE EXCEPTION 'Maiden first publication failed'; END IF;
  SELECT dna.publish_maiden_allocation_evidence_snapshot(dna.current_owner_id(),
    v_source,'2026-10-16T00:30:00Z',v_body,v_sha) INTO v_status;
  IF v_status<>'unchanged' THEN RAISE EXCEPTION 'Maiden idempotent publication failed'; END IF;
  BEGIN
    PERFORM * FROM dna.read_maiden_allocation_accepted_generation('91280000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'cross-owner Maiden generation read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner Maiden generation read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.maiden_allocation_accepted_generation;
    RAISE EXCEPTION 'direct runtime Maiden generation read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
RESET ROLE;

UPDATE dna.maiden_allocation_accepted_generation
SET source_identity_json='{"correctionVersion":"owner-v2","methodVersion":"approved-v1"}',
  source_evidence_sha256=encode(sha256(convert_to('{"correctionVersion":"owner-v2","methodVersion":"approved-v1"}','UTF8')),'hex'),
  generation_json=jsonb_set(generation_json::jsonb,'{sourceEvidenceSha256}',
    to_jsonb(encode(sha256(convert_to('{"correctionVersion":"owner-v2","methodVersion":"approved-v1"}','UTF8')),'hex')))::text
WHERE owner_id='91280000-0000-4000-8000-000000000001';

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91280000-0000-4000-8000-000000000001';
DO $drift$
DECLARE v_body text; v_sha text; v_status text;
BEGIN
  v_body := (SELECT snapshot_json FROM dna.read_maiden_allocation_evidence_snapshot(dna.current_owner_id()));
  v_sha := encode(sha256(convert_to(v_body,'UTF8')),'hex');
  SELECT dna.publish_maiden_allocation_evidence_snapshot(dna.current_owner_id(),
    (v_body::jsonb->>'sourceEvidenceSha256'),'2026-10-16T00:30:00Z',v_body,v_sha)
    INTO v_status;
  IF v_status<>'source_changed' THEN RAISE EXCEPTION 'Maiden source drift accepted'; END IF;
  IF (SELECT count(*) FROM dna.read_maiden_allocation_evidence_snapshot(dna.current_owner_id()))<>1 THEN
    RAISE EXCEPTION 'Maiden source drift destroyed last-good';
  END IF;
END
$drift$;
RESET ROLE;
ROLLBACK;

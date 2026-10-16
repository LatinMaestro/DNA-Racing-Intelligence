BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91400000-0000-4000-8000-000000000001', 'smoke_readiness_owner'),
  ('91400000-0000-4000-8000-000000000002', 'smoke_readiness_other');

INSERT INTO dna.private_readiness_assessment_snapshot (
  owner_id, assessment_id, assessment_version, exact_head_sha,
  evidence_current_through, assessed_at, published_at,
  snapshot_sha256, snapshot_json
)
SELECT owner_id, 'readiness-1', 'readiness-v1', repeat('a',40),
  '2026-10-15T00:00:00Z', '2026-10-15T01:00:00Z',
  '2026-10-15T02:00:00Z',
  encode(sha256(convert_to(body,'UTF8')),'hex'), body
FROM (
  SELECT id AS owner_id, jsonb_build_object(
    'version',1,
    'databaseOwnerId',id::text,
    'publishedAt','2026-10-15T02:00:00.000Z',
    'assessment',jsonb_build_object(
      'assessmentId','readiness-1',
      'assessmentVersion','readiness-v1',
      'assessedAt','2026-10-15T01:00:00.000Z',
      'evidenceCurrentThrough','2026-10-15T00:00:00.000Z',
      'evidenceFreshness','current',
      'exactHeadSha',repeat('a',40),
      'gates',jsonb_build_object(
        'gateA','accepted','gateB','not_accepted','gateC','not_accepted',
        'gateD','not_accepted','gateE','not_accepted'),
      'exactHeadCi','passed',
      'representativePrivateImport','not_run',
      'recoveryValidation','passed',
      'performanceCapacity','not_run',
      'securityPrivacy','not_run',
      'accessibilityResponsive','not_run',
      'migrations','reversible_verified',
      'knownLimitationsDocumented',true,
      'productionDisabled',true,
      'customDomainAttached',false,
      'publicRoutesExposed',false,
      'fullPrivateDataInProduction',false,
      'recurringPaidInfrastructureEnabled',false,
      'ownerGateFApproval',false,
      'activationRequested',false
    )
  )::text AS body
  FROM dna.app_owner
  WHERE id IN (
    '91400000-0000-4000-8000-000000000001',
    '91400000-0000-4000-8000-000000000002'
  )
) fixture;

DO $checks$
DECLARE v_privilege text; v_rls boolean; v_force boolean; v_body text;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
  FROM pg_class WHERE oid='dna.private_readiness_assessment_snapshot'::regclass;
  IF NOT v_rls OR NOT v_force THEN RAISE EXCEPTION 'forced readiness isolation missing'; END IF;
  FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('dna_app_runtime','dna.private_readiness_assessment_snapshot',v_privilege) THEN
      RAISE EXCEPTION 'runtime readiness table privilege unexpectedly present';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime','dna.read_private_readiness_assessment_snapshot(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'runtime readiness function permission missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
    WHERE p.oid='dna.read_private_readiness_assessment_snapshot(uuid)'::regprocedure
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'public readiness read permission present';
  END IF;
  IF NOT (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    FROM pg_proc WHERE oid='dna.read_private_readiness_assessment_snapshot(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'readiness function configuration unsafe';
  END IF;
  BEGIN
    UPDATE dna.private_readiness_assessment_snapshot SET snapshot_sha256=repeat('b',64);
    RAISE EXCEPTION 'bad readiness checksum accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.private_readiness_assessment_snapshot SET assessment_version='readiness-v2';
    RAISE EXCEPTION 'mismatched readiness version accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE dna.private_readiness_assessment_snapshot SET evidence_current_through='2026-10-15T03:00:00Z';
    RAISE EXCEPTION 'invalid readiness chronology accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT (snapshot_json::jsonb || jsonb_build_object('padding',repeat('x',32769)))::text
    INTO v_body FROM dna.private_readiness_assessment_snapshot
    WHERE owner_id='91400000-0000-4000-8000-000000000001';
  BEGIN
    UPDATE dna.private_readiness_assessment_snapshot
      SET snapshot_json=v_body,
        snapshot_sha256=encode(sha256(convert_to(v_body,'UTF8')),'hex')
      WHERE owner_id='91400000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'oversized readiness payload accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT count(*) FROM dna.private_readiness_assessment_snapshot)<>2 THEN
    RAISE EXCEPTION 'rejected mutations changed stored readiness rows';
  END IF;
END
$checks$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91400000-0000-4000-8000-000000000001';
DO $runtime$
BEGIN
  IF (SELECT count(*) FROM dna.read_private_readiness_assessment_snapshot(dna.current_owner_id()))<>1 THEN
    RAISE EXCEPTION 'owner readiness read failed';
  END IF;
  BEGIN
    PERFORM * FROM dna.read_private_readiness_assessment_snapshot('91400000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'cross-owner readiness read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner readiness read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.private_readiness_assessment_snapshot;
    RAISE EXCEPTION 'direct runtime readiness read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM dna.private_readiness_assessment_snapshot;
    RAISE EXCEPTION 'direct runtime readiness write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
SET LOCAL app.owner_id = '';
DO $missing_scope$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_private_readiness_assessment_snapshot('91400000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'unscoped readiness read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='unscoped readiness read accepted' THEN RAISE; END IF;
  END;
END
$missing_scope$;
RESET ROLE;

CREATE ROLE dna_ci_readiness_rls NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA dna TO dna_ci_readiness_rls;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_readiness_rls;
ALTER TABLE dna.private_readiness_assessment_snapshot OWNER TO dna_ci_readiness_rls;
SET LOCAL ROLE dna_ci_readiness_rls;
SET LOCAL app.owner_id = '91400000-0000-4000-8000-000000000001';
DO $rls$
BEGIN
  IF (SELECT count(*) FROM dna.private_readiness_assessment_snapshot)<>1 THEN
    RAISE EXCEPTION 'forced readiness RLS failed for table owner';
  END IF;
  BEGIN
    UPDATE dna.private_readiness_assessment_snapshot
      SET owner_id='91400000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'cross-owner readiness mutation accepted';
  EXCEPTION WHEN unique_violation OR insufficient_privilege THEN NULL; END;
END
$rls$;
RESET ROLE;
ROLLBACK;

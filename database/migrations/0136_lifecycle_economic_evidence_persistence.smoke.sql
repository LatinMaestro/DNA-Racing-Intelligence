BEGIN;

INSERT INTO dna.app_owner(id,clerk_user_id) VALUES
  ('91600000-0000-4000-8000-000000000001','smoke_lifecycle_owner'),
  ('91600000-0000-4000-8000-000000000002','smoke_lifecycle_other');
INSERT INTO dna.asset_currency(id,owner_id,code,display_name,asset_kind,atomic_scale)
VALUES('91600000-0000-4000-8000-000000000101',
  '91600000-0000-4000-8000-000000000001','BGC','BGC','bgc',2);

DO $permissions$
DECLARE v_table text; v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dna.lifecycle_economic_state','dna.lifecycle_economic_evidence'
  ] LOOP
    IF NOT(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid=v_table::regclass) THEN
      RAISE EXCEPTION 'lifecycle economic forced RLS missing';
    END IF;
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ] LOOP
      IF has_table_privilege('dna_app_runtime',v_table,v_privilege) THEN
        RAISE EXCEPTION 'runtime lifecycle economic table privilege present';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime',
      'dna.read_lifecycle_economic_write_context(uuid)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_lifecycle_economic_evidence(uuid,text)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.list_lifecycle_burn_credit_evidence(uuid,text)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.write_lifecycle_economic_evidence(uuid,text,text,text,character,character,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'runtime lifecycle economic function grant missing'; END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id='91600000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE
  v_assets_version text; v_version text; v_status text;
  v_burn text; v_burn_hash text; v_credit text; v_credit_hash text;
  v_stale text; v_stale_hash text;
BEGIN
  SELECT context.asset_registry_version,context.lifecycle_version
  INTO v_assets_version,v_version
  FROM dna.read_lifecycle_economic_write_context(dna.current_owner_id()) context;
  IF v_assets_version IS NULL OR v_version<>'0' THEN
    RAISE EXCEPTION 'lifecycle economic context invalid';
  END IF;
  v_burn:=jsonb_build_object(
    'input',jsonb_build_object(
      'burnId','core_burn:smoke-0001','coreId','core-smoke','coreClass','Freak',
      'occurredAt','2026-10-16T00:00:00.000Z','recordedAt','2026-10-16T01:00:00.000Z',
      'evidenceSource','manual','evidenceStatus','confirmed',
      'ownershipAtBurn','confirmed_active','reason','Synthetic smoke evidence.',
      'recommendationReferenceId',NULL),
    'result',jsonb_build_object(
      'burnId','core_burn:smoke-0001','coreId','core-smoke',
      'status','confirmed_event_review','reviewReasons',jsonb_build_array(),
      'activeVaultProjection','remove_after_review','historicalLineageRetained',true,
      'burnCreditAmount',NULL,'burnCreditPredicted',false,
      'recommendationWasExecutionEvidence',false,'burnExecutionAllowed',false,
      'ownershipMutationAllowed',false,'ledgerMutationAllowed',false))::text;
  v_burn_hash:=encode(sha256(convert_to(v_burn,'UTF8')),'hex');
  SELECT result.disposition,result.lifecycle_version INTO v_status,v_version
  FROM dna.write_lifecycle_economic_evidence(dna.current_owner_id(),
    'core_burn','core_burn:smoke-0001',NULL,v_burn_hash,v_burn_hash,v_burn,v_version) result;
  IF v_status<>'created' OR v_version<>'1' THEN
    RAISE EXCEPTION 'lifecycle burn write failed';
  END IF;

  v_credit:=jsonb_build_object(
    'credit',jsonb_build_object(
      'creditId','burn_bgc_credit:smoke-0001','coreId','core-smoke',
      'burnId','core_burn:smoke-0001','occurredAt','2026-10-16T02:00:00.000Z',
      'asset','BGC','amount','12','evidenceSource','manual',
      'evidenceStatus','confirmed','externalReference',NULL),
    'reconciliation',jsonb_build_object(
      'burnId','core_burn:smoke-0001','coreId','core-smoke',
      'status','matched_actual_credit','matchedCreditId','burn_bgc_credit:smoke-0001',
      'actualBgcAmount','12','reviewItems',jsonb_build_array(),
      'ledgerPostingProposed',true,'automaticExclusionAllowed',false,
      'creditPredicted',false,'strategicRecommendationUsed',false,
      'burnEventMutated',false),
    'asset',jsonb_build_object('code','BGC','kind','game_credit','precision',2,
      'registryVersion',v_assets_version))::text;
  v_credit_hash:=encode(sha256(convert_to(v_credit,'UTF8')),'hex');
  SELECT result.disposition,result.lifecycle_version INTO v_status,v_version
  FROM dna.write_lifecycle_economic_evidence(dna.current_owner_id(),
    'burn_bgc_credit','burn_bgc_credit:smoke-0001','core_burn:smoke-0001',
    v_credit_hash,v_credit_hash,v_credit,v_version) result;
  IF v_status<>'created' OR v_version<>'2' THEN
    RAISE EXCEPTION 'lifecycle credit write failed';
  END IF;
  SELECT result.disposition INTO v_status
  FROM dna.write_lifecycle_economic_evidence(dna.current_owner_id(),
    'core_burn','core_burn:smoke-0001',NULL,v_burn_hash,v_burn_hash,v_burn,'0') result;
  IF v_status<>'already_exists' THEN RAISE EXCEPTION 'lifecycle replay failed'; END IF;
  v_stale:=replace(v_burn,'core_burn:smoke-0001','core_burn:stale-0001');
  v_stale_hash:=encode(sha256(convert_to(v_stale,'UTF8')),'hex');
  SELECT result.disposition INTO v_status
  FROM dna.write_lifecycle_economic_evidence(dna.current_owner_id(),
    'core_burn','core_burn:stale-0001',NULL,v_stale_hash,v_stale_hash,v_stale,'0') result;
  IF v_status<>'version_conflict' THEN RAISE EXCEPTION 'stale lifecycle write accepted'; END IF;
  IF (SELECT count(*) FROM dna.list_lifecycle_burn_credit_evidence(
      dna.current_owner_id(),'core_burn:smoke-0001'))<>1
    OR (SELECT count(*) FROM dna.read_lifecycle_economic_evidence(
      dna.current_owner_id(),'core_burn:smoke-0001'))<>1
  THEN RAISE EXCEPTION 'lifecycle economic reads incomplete'; END IF;
  BEGIN
    PERFORM * FROM dna.read_lifecycle_economic_evidence(
      '91600000-0000-4000-8000-000000000002','core_burn:smoke-0001');
    RAISE EXCEPTION 'cross-owner lifecycle read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner lifecycle read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.lifecycle_economic_evidence;
    RAISE EXCEPTION 'direct lifecycle read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
RESET ROLE;

ROLLBACK;

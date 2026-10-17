BEGIN;

INSERT INTO dna.app_owner(id,clerk_user_id) VALUES
  ('91700000-0000-4000-8000-000000000001','smoke_breeding_owner'),
  ('91700000-0000-4000-8000-000000000002','smoke_breeding_other');
INSERT INTO dna.asset_currency(id,owner_id,code,display_name,asset_kind,atomic_scale)
VALUES('91700000-0000-4000-8000-000000000101',
  '91700000-0000-4000-8000-000000000001','DEZ','DEZ','crypto',4);

DO $permissions$
DECLARE v_table text; v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dna.breeding_economic_state','dna.breeding_economic_record',
    'dna.breeding_cost_basis_transaction'
  ] LOOP
    IF NOT(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid=v_table::regclass) THEN
      RAISE EXCEPTION 'breeding economic forced RLS missing';
    END IF;
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ] LOOP
      IF has_table_privilege('dna_app_runtime',v_table,v_privilege) THEN
        RAISE EXCEPTION 'runtime breeding economic table privilege present';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime',
      'dna.read_breeding_economic_write_context(uuid)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_breeding_economic_record(uuid,text)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.list_assigned_breeding_cost_transactions(uuid,text[])','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.write_breeding_economic_record(uuid,text,text,character,character,text,text,text[])','EXECUTE')
  THEN RAISE EXCEPTION 'runtime breeding economic function grant missing'; END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id='91700000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE
  v_assets_version text; v_version text; v_status text;
  v_evidence text; v_evidence_hash text; v_cost text; v_cost_hash text;
  v_stale text; v_stale_hash text;
BEGIN
  SELECT context.asset_registry_version,context.economic_version
  INTO v_assets_version,v_version
  FROM dna.read_breeding_economic_write_context(dna.current_owner_id()) context;
  IF v_assets_version IS NULL OR v_version<>'0' THEN
    RAISE EXCEPTION 'breeding economic context invalid';
  END IF;

  v_evidence:=jsonb_build_object(
    'input',jsonb_build_object(
      'evidenceId','breeding_economic_evidence:smoke-0001',
      'breedingEventId','breeding-event-smoke-0001','source','manual_confirmed',
      'lifecycle','completed','occurredAt','2026-10-16T00:00:00.000Z',
      'parentCoreIds',jsonb_build_array('parent-a','parent-b'),
      'offspringCoreId','offspring-smoke','evidenceNote','Synthetic smoke.',
      'entries',jsonb_build_array(jsonb_build_object(
        'transactionId','breeding-transaction-smoke-0001',
        'category','dna_base_fee','direction','debit','assetCode','DEZ',
        'assetKind','crypto','amount','2.5','externalReference',NULL))),
    'assessment',jsonb_build_object(
      'evidenceId','breeding_economic_evidence:smoke-0001',
      'status','postable_review','postings',jsonb_build_array(),
      'ledgerMutationAllowed',false),
    'assets',jsonb_build_array(jsonb_build_object(
      'code','DEZ','kind','crypto','precision',4,
      'registryVersion',v_assets_version)))::text;
  v_evidence_hash:=encode(sha256(convert_to(v_evidence,'UTF8')),'hex');
  SELECT result.disposition,result.economic_version INTO v_status,v_version
  FROM dna.write_breeding_economic_record(dna.current_owner_id(),
    'evidence','breeding_economic_evidence:smoke-0001',v_evidence_hash,
    v_evidence_hash,v_evidence,'0',ARRAY[]::text[]) result;
  IF v_status<>'created' OR v_version<>'1' THEN
    RAISE EXCEPTION 'breeding economic evidence write failed';
  END IF;

  v_cost:=jsonb_build_object(
    'request',jsonb_build_object(
      'assignmentId','offspring_cost_basis:smoke-0001',
      'offspringCoreId','offspring-smoke',
      'breedingEventId','breeding-event-smoke-0001',
      'breedingOccurredAt','2026-10-16T00:00:00.000Z',
      'requestedAt','2026-10-16T01:00:00.000Z',
      'ownershipStatus','confirmed_owned','breedingEventStatus','completed',
      'costs',jsonb_build_array(jsonb_build_object(
        'transactionId','breeding-transaction-smoke-0001',
        'category','dna_base_fee','source','manual_confirmed',
        'evidenceStatus','confirmed','assetCode','DEZ','assetKind','crypto',
        'amount','2.5')),'refunds',jsonb_build_array()),
    'assessment',jsonb_build_object(
      'assignmentId','offspring_cost_basis:smoke-0001',
      'status','assignment_review','assignmentMutationAllowed',false,
      'originalAssetsCombined',false,'marketValueAssigned',false,
      'realisedGainCalculated',false),
    'assets',jsonb_build_array(jsonb_build_object(
      'code','DEZ','kind','crypto','precision',4,
      'registryVersion',v_assets_version)))::text;
  v_cost_hash:=encode(sha256(convert_to(v_cost,'UTF8')),'hex');
  SELECT result.disposition,result.economic_version INTO v_status,v_version
  FROM dna.write_breeding_economic_record(dna.current_owner_id(),
    'cost_basis','offspring_cost_basis:smoke-0001',v_cost_hash,v_cost_hash,
    v_cost,v_version,ARRAY['breeding-transaction-smoke-0001']) result;
  IF v_status<>'created' OR v_version<>'2' THEN
    RAISE EXCEPTION 'breeding cost-basis write failed';
  END IF;
  SELECT result.disposition INTO v_status
  FROM dna.write_breeding_economic_record(dna.current_owner_id(),
    'cost_basis','offspring_cost_basis:smoke-0001',v_cost_hash,v_cost_hash,
    v_cost,'0',ARRAY['breeding-transaction-smoke-0001']) result;
  IF v_status<>'already_exists' THEN RAISE EXCEPTION 'breeding replay failed'; END IF;

  v_stale:=replace(v_evidence,'smoke-0001','stale-0001');
  v_stale_hash:=encode(sha256(convert_to(v_stale,'UTF8')),'hex');
  SELECT result.disposition INTO v_status
  FROM dna.write_breeding_economic_record(dna.current_owner_id(),
    'evidence','breeding_economic_evidence:stale-0001',v_stale_hash,
    v_stale_hash,v_stale,'0',ARRAY[]::text[]) result;
  IF v_status<>'version_conflict' THEN RAISE EXCEPTION 'stale breeding write accepted'; END IF;
  IF (SELECT count(*) FROM dna.read_breeding_economic_record(
      dna.current_owner_id(),'breeding_economic_evidence:smoke-0001'))<>1
    OR (SELECT count(*) FROM dna.list_assigned_breeding_cost_transactions(
      dna.current_owner_id(),ARRAY['breeding-transaction-smoke-0001']))<>1
  THEN RAISE EXCEPTION 'breeding economic reads incomplete'; END IF;
  BEGIN
    PERFORM * FROM dna.read_breeding_economic_record(
      '91700000-0000-4000-8000-000000000002',
      'breeding_economic_evidence:smoke-0001');
    RAISE EXCEPTION 'cross-owner breeding read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner breeding read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.breeding_economic_record;
    RAISE EXCEPTION 'direct breeding read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
RESET ROLE;

ROLLBACK;

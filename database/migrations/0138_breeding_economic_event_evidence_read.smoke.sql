BEGIN;

INSERT INTO dna.app_owner(id,clerk_user_id) VALUES
  ('91800000-0000-4000-8000-000000000001','smoke_breeding_event_owner'),
  ('91800000-0000-4000-8000-000000000002','smoke_breeding_event_other');
INSERT INTO dna.asset_currency(id,owner_id,code,display_name,asset_kind,atomic_scale)
VALUES('91800000-0000-4000-8000-000000000101',
  '91800000-0000-4000-8000-000000000001','DEZ','DEZ','crypto',4);

DO $permissions$
BEGIN
  IF NOT has_function_privilege('dna_app_runtime',
      'dna.list_breeding_economic_evidence_by_event(uuid,text,integer)',
      'EXECUTE')
    OR has_table_privilege('dna_app_runtime',
      'dna.breeding_economic_record','SELECT')
  THEN RAISE EXCEPTION 'breeding event evidence least privilege invalid'; END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id='91800000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE
  v_assets_version text; v_evidence text; v_hash text; v_status text;
BEGIN
  SELECT context.asset_registry_version INTO v_assets_version
  FROM dna.read_breeding_economic_write_context(dna.current_owner_id()) context;
  v_evidence:=jsonb_build_object(
    'input',jsonb_build_object(
      'evidenceId','breeding_economic_evidence:event-read-0001',
      'breedingEventId','breeding-event-read-0001','source','manual_confirmed',
      'lifecycle','completed','occurredAt','2026-10-16T00:00:00.000Z',
      'parentCoreIds',jsonb_build_array('parent-a','parent-b'),
      'offspringCoreId','offspring-smoke','evidenceNote','Synthetic smoke.',
      'entries',jsonb_build_array(jsonb_build_object(
        'transactionId','breeding-transaction-read-0001',
        'category','dna_base_fee','direction','debit','assetCode','DEZ',
        'assetKind','crypto','amount','2.5','externalReference',NULL))),
    'assessment',jsonb_build_object(
      'evidenceId','breeding_economic_evidence:event-read-0001',
      'status','postable_review','postings',jsonb_build_array(),
      'ledgerMutationAllowed',false),
    'assets',jsonb_build_array(jsonb_build_object(
      'code','DEZ','kind','crypto','precision',4,
      'registryVersion',v_assets_version)))::text;
  v_hash:=encode(sha256(convert_to(v_evidence,'UTF8')),'hex');
  SELECT result.disposition INTO v_status
  FROM dna.write_breeding_economic_record(dna.current_owner_id(),
    'evidence','breeding_economic_evidence:event-read-0001',v_hash,v_hash,
    v_evidence,'0',ARRAY[]::text[]) result;
  IF v_status<>'created'
    OR (SELECT count(*) FROM dna.list_breeding_economic_evidence_by_event(
      dna.current_owner_id(),'breeding-event-read-0001',1))<>1
    OR (SELECT count(*) FROM dna.list_breeding_economic_evidence_by_event(
      dna.current_owner_id(),'missing-event',1))<>0
  THEN RAISE EXCEPTION 'bounded breeding event evidence read failed'; END IF;
  BEGIN
    PERFORM * FROM dna.list_breeding_economic_evidence_by_event(
      dna.current_owner_id(),'breeding-event-read-0001',129);
    RAISE EXCEPTION 'oversized breeding event evidence read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='oversized breeding event evidence read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.list_breeding_economic_evidence_by_event(
      '91800000-0000-4000-8000-000000000002','breeding-event-read-0001',1);
    RAISE EXCEPTION 'cross-owner breeding event evidence read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner breeding event evidence read accepted' THEN RAISE; END IF;
  END;
END
$runtime$;
RESET ROLE;

ROLLBACK;

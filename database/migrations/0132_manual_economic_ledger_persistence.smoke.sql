BEGIN;

INSERT INTO dna.app_owner(id,clerk_user_id) VALUES
  ('91500000-0000-4000-8000-000000000001','smoke_manual_economic_owner'),
  ('91500000-0000-4000-8000-000000000002','smoke_manual_economic_other');
INSERT INTO dna.asset_currency(
  id,owner_id,code,display_name,asset_kind,atomic_scale
) VALUES (
  '91500000-0000-4000-8000-000000000101',
  '91500000-0000-4000-8000-000000000001',
  'DEZ','DEZ','crypto',6
);

DO $permissions$
DECLARE v_table text; v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dna.manual_economic_entry','dna.manual_economic_reversal'
  ] LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity
      FROM pg_class WHERE oid=v_table::regclass)
    THEN RAISE EXCEPTION 'manual economic forced RLS missing'; END IF;
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ] LOOP
      IF has_table_privilege('dna_app_runtime',v_table,v_privilege) THEN
        RAISE EXCEPTION 'runtime manual economic table privilege present';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime',
    'dna.read_manual_economic_write_context(uuid)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
    'dna.write_manual_economic_entry(uuid,text,character,text,text)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
    'dna.write_manual_economic_reversal(uuid,text,text,character,text,character,text)','EXECUTE')
  THEN RAISE EXCEPTION 'runtime manual economic function grant missing'; END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id='91500000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE
  v_asset_version text;
  v_entry text;
  v_entry_hash text;
  v_stale_entry text;
  v_stale_entry_hash text;
  v_version text;
  v_initial_version bigint;
  v_reversal text;
  v_reversal_hash text;
  v_status text;
BEGIN
  SELECT context.asset_registry_version,context.ledger_version
  INTO v_asset_version,v_version
  FROM dna.read_manual_economic_write_context(dna.current_owner_id()) context;
  IF v_asset_version IS NULL OR v_version !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION 'manual economic context invalid';
  END IF;
  v_initial_version := v_version::bigint;
  v_entry := jsonb_build_object(
    'entryId','manual-entry-0001',
    'occurredAt','2026-10-16T00:00:00.000Z',
    'assetCode','DEZ','assetKind','crypto',
    'assetRegistryVersion',v_asset_version,'assetPrecision',6,
    'amount','1.25','category','income','subcategory','other_income',
    'tournamentId',NULL,'tournamentCampaignBinding',NULL,
    'tournamentAggregationEligible',true,'coreIds',jsonb_build_array(),
    'externalReference',NULL,'note','synthetic smoke evidence',
    'postings',jsonb_build_array(jsonb_build_object(
      'postingId','manual-entry-0001:primary','accountLabel','owner',
      'assetCode','DEZ','assetKind','crypto','signedAmount','1.25',
      'category','income','subcategory','other_income','operating',true,
      'tournamentAggregationEligible',true
    )),'warnings',jsonb_build_array(),'completeness','complete'
  )::text;
  v_entry_hash := encode(sha256(convert_to(v_entry,'UTF8')),'hex');
  SELECT result.disposition,result.ledger_version
  INTO v_status,v_version
  FROM dna.write_manual_economic_entry(
    dna.current_owner_id(),'manual-entry-0001',v_entry_hash,v_entry,v_version
  ) result;
  IF v_status<>'created' OR v_version::bigint<>v_initial_version+1 THEN
    RAISE EXCEPTION 'manual economic entry write failed';
  END IF;
  v_stale_entry := replace(v_entry,'manual-entry-0001','manual-entry-stale');
  v_stale_entry_hash := encode(
    sha256(convert_to(v_stale_entry,'UTF8')),'hex'
  );
  SELECT result.disposition INTO v_status
  FROM dna.write_manual_economic_entry(
    dna.current_owner_id(),'manual-entry-stale',v_stale_entry_hash,
    v_stale_entry,v_initial_version::text
  ) result;
  IF v_status<>'version_conflict' OR EXISTS (
    SELECT 1 FROM dna.read_manual_economic_entry(
      dna.current_owner_id(),'manual-entry-stale')
  ) THEN
    RAISE EXCEPTION 'stale manual economic write was not atomic';
  END IF;
  SELECT result.disposition INTO v_status
  FROM dna.write_manual_economic_entry(
    dna.current_owner_id(),'manual-entry-0001',v_entry_hash,v_entry,
    v_initial_version::text
  ) result;
  IF v_status<>'already_exists' THEN
    RAISE EXCEPTION 'manual economic replay failed';
  END IF;
  v_reversal := jsonb_build_object(
    'reversalId','manual-reversal-0001',
    'originalEntryId','manual-entry-0001',
    'originalEntryFingerprint',v_entry_hash,
    'reversedAt','2026-10-16T01:00:00.000Z','reason','synthetic correction',
    'assetCode','DEZ','assetKind','crypto',
    'assetRegistryVersion',v_asset_version,'assetPrecision',6,
    'postings',jsonb_build_array(jsonb_build_object(
      'postingId','manual-reversal-0001:manual-entry-0001:primary',
      'originalPostingId','manual-entry-0001:primary',
      'accountLabel','owner','assetCode','DEZ','assetKind','crypto',
      'signedAmount','-1.25','operating',true,
      'tournamentAggregationEligible',true
    )),'sourceFactsMutated',false
  )::text;
  v_reversal_hash := encode(sha256(convert_to(v_reversal,'UTF8')),'hex');
  SELECT result.disposition,result.ledger_version
  INTO v_status,v_version
  FROM dna.write_manual_economic_reversal(
    dna.current_owner_id(),'manual-reversal-0001','manual-entry-0001',
    v_reversal_hash,v_reversal,v_entry_hash,v_version
  ) result;
  IF v_status<>'created' OR v_version::bigint<>v_initial_version+2 THEN
    RAISE EXCEPTION 'manual economic reversal write failed';
  END IF;
  IF (SELECT count(*) FROM dna.read_manual_economic_entry(
    dna.current_owner_id(),'manual-entry-0001'))<>1
  THEN RAISE EXCEPTION 'manual economic durable evidence incomplete'; END IF;
  BEGIN
    PERFORM * FROM dna.read_manual_economic_entry(
      '91500000-0000-4000-8000-000000000002','manual-entry-0001');
    RAISE EXCEPTION 'cross-owner manual economic read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner manual economic read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.manual_economic_entry;
    RAISE EXCEPTION 'direct runtime manual economic read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
RESET ROLE;

DO $stored$
BEGIN
  IF (SELECT count(*) FROM dna.manual_economic_entry
      WHERE owner_id='91500000-0000-4000-8000-000000000001')<>1
    OR (SELECT count(*) FROM dna.manual_economic_reversal
      WHERE owner_id='91500000-0000-4000-8000-000000000001')<>1
    OR (SELECT count(*) FROM dna.economic_transaction
      WHERE owner_id='91500000-0000-4000-8000-000000000001')<>2
  THEN RAISE EXCEPTION 'manual economic durable evidence incomplete'; END IF;
END
$stored$;

ROLLBACK;

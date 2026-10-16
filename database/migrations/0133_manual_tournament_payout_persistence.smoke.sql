BEGIN;

INSERT INTO dna.app_owner(id,clerk_user_id) VALUES
  ('91600000-0000-4000-8000-000000000001','smoke_tournament_payout_owner'),
  ('91600000-0000-4000-8000-000000000002','smoke_tournament_payout_other');
INSERT INTO dna.asset_currency(id,owner_id,code,display_name,asset_kind,atomic_scale)
VALUES('91600000-0000-4000-8000-000000000101',
  '91600000-0000-4000-8000-000000000001','DEZ','DEZ','crypto',6);

DO $permissions$
DECLARE v_table text; v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dna.manual_tournament_payout_candidate_set','dna.manual_tournament_payout_state'
  ] LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid=v_table::regclass) THEN
      RAISE EXCEPTION 'manual tournament payout forced RLS missing';
    END IF;
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ] LOOP
      IF has_table_privilege('dna_app_runtime',v_table,v_privilege) THEN
        RAISE EXCEPTION 'runtime manual tournament payout table privilege present';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime',
    'dna.read_manual_tournament_payout_candidates(uuid,text,timestamptz,text,text,integer)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
    'dna.write_manual_tournament_payout(uuid,text,character,text,text,text,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'runtime tournament payout function grant missing'; END IF;
END
$permissions$;

DO $fixture$
DECLARE v_candidates text; v_envelope text;
BEGIN
  v_candidates:=jsonb_build_array(jsonb_build_object(
    'transactionId','imported-prize-1','occurredAt','2026-10-16T00:00:00.000Z',
    'tournamentId','tournament-1','bracketId',NULL,'stage','final',
    'assetCode','DEZ','amount','10','externalReference',NULL,
    'aggregateStatus','included'))::text;
  v_envelope:=jsonb_build_object('activeImportSnapshotHash',repeat('a',64),
    'query',jsonb_build_object('tournamentId','tournament-1',
      'occurredAt','2026-10-16T00:00:00.000Z','assetCode','DEZ','amount','10',
      'maximumCandidates',250),'candidates',v_candidates::jsonb)::text;
  INSERT INTO dna.manual_tournament_payout_candidate_set(
    owner_id,tournament_id,occurred_at,asset_code,amount,maximum_candidates,
    active_import_snapshot_hash,candidate_set_hash,canonical_envelope,
    candidates_json,published_at)
  VALUES('91600000-0000-4000-8000-000000000001','tournament-1',
    '2026-10-16T00:00:00Z','DEZ','10',250,repeat('a',64),
    encode(sha256(convert_to(v_envelope,'UTF8')),'hex'),v_envelope,v_candidates,
    '2026-10-16T01:00:00Z');
END
$fixture$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id='91600000-0000-4000-8000-000000000001';
DO $runtime$
DECLARE
  v_count integer;
  v_context record;
  v_candidate_hash text;
  v_payout text;
  v_evidence text;
  v_status text;
  v_version text;
BEGIN
  SELECT count(*),max(candidate_set_hash) INTO v_count,v_candidate_hash
  FROM dna.read_manual_tournament_payout_candidates(dna.current_owner_id(),
    'tournament-1','2026-10-16T00:00:00Z','DEZ','10',250);
  IF v_count<>1 THEN RAISE EXCEPTION 'accepted payout candidates unavailable'; END IF;
  SELECT * INTO v_context FROM dna.read_manual_tournament_payout_write_context(dna.current_owner_id());
  IF v_context.asset_registry_version IS NULL OR v_context.ledger_version IS NULL THEN
    RAISE EXCEPTION 'tournament payout write context invalid';
  END IF;
  v_payout:=jsonb_build_object(
    'payoutId','payout-0001','occurredAt','2026-10-16T00:00:00.000Z',
    'tournamentId','tournament-1','amount','10','assetCode','DEZ',
    'assetKind','crypto','assetDecimalPlaces',6,
    'assetRegistryVersion',v_context.asset_registry_version,
    'sourceType','manual_tournament_payout',
    'tournamentAggregationEligible',true,'duplicateReviewRequired',true,
    'externalReference',NULL,'evidenceNote','synthetic smoke evidence')::text;
  v_evidence:=jsonb_build_object('activeImportSnapshotHash',repeat('a',64),
    'candidateSetHash',v_candidate_hash,
    'candidateTransactionIds',jsonb_build_array('imported-prize-1'))::text;
  SELECT result.disposition,result.ledger_version INTO v_status,v_version
  FROM dna.write_manual_tournament_payout(dna.current_owner_id(),
    'payout-0001',repeat('b',64),v_payout,
    jsonb_build_object('status','review_required')::text,v_evidence,
    v_context.ledger_version,repeat('b',64)) result;
  IF v_status<>'created' OR v_version::bigint<=v_context.ledger_version::bigint
    OR (SELECT count(*) FROM dna.read_manual_tournament_payout(
      dna.current_owner_id(),'payout-0001'))<>1
  THEN RAISE EXCEPTION 'manual tournament payout write failed'; END IF;
  BEGIN
    PERFORM * FROM dna.read_manual_tournament_payout_candidates(
      '91600000-0000-4000-8000-000000000002','tournament-1',
      '2026-10-16T00:00:00Z','DEZ','10',250);
    RAISE EXCEPTION 'cross-owner tournament payout read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner tournament payout read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.manual_tournament_payout_candidate_set;
    RAISE EXCEPTION 'direct runtime candidate read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;
RESET ROLE;

ROLLBACK;

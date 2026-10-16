BEGIN;

-- Accepted candidate evidence is published by the private import boundary as
-- an exact query result. Runtime reads never infer tournament identity from
-- free-form ledger rows and never scan the full economic ledger.
CREATE TABLE dna.manual_tournament_payout_candidate_set (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
  asset_code text NOT NULL CHECK (asset_code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  amount text NOT NULL,
  maximum_candidates integer NOT NULL CHECK (maximum_candidates BETWEEN 1 AND 250),
  active_import_snapshot_hash character(64) NOT NULL CHECK (
    active_import_snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  candidate_set_hash character(64) NOT NULL CHECK (candidate_set_hash ~ '^[a-f0-9]{64}$'),
  canonical_envelope text NOT NULL CHECK (jsonb_typeof(canonical_envelope::jsonb)='object'),
  candidates_json text NOT NULL CHECK (
    jsonb_typeof(candidates_json::jsonb)='array' AND
    jsonb_array_length(candidates_json::jsonb) <= maximum_candidates
  ),
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  PRIMARY KEY (owner_id,tournament_id,occurred_at,asset_code,amount,maximum_candidates),
  CHECK (candidate_set_hash=encode(sha256(convert_to(canonical_envelope,'UTF8')),'hex')),
  CHECK (canonical_envelope::jsonb -> 'candidates'=candidates_json::jsonb),
  CHECK (canonical_envelope::jsonb ->> 'activeImportSnapshotHash'=active_import_snapshot_hash)
);

CREATE TABLE dna.manual_tournament_payout_state (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  payout_id text NOT NULL,
  payout_json text NOT NULL CHECK (jsonb_typeof(payout_json::jsonb)='object'),
  state_fingerprint character(64) NOT NULL CHECK (state_fingerprint ~ '^[a-f0-9]{64}$'),
  reconciliation_json text NOT NULL CHECK (jsonb_typeof(reconciliation_json::jsonb)='object'),
  reconciliation_evidence_json text NOT NULL CHECK (
    jsonb_typeof(reconciliation_evidence_json::jsonb)='object'
  ),
  reconciliation_revision bigint NOT NULL DEFAULT 0 CHECK (reconciliation_revision>=0),
  ledger_version text NOT NULL CHECK (ledger_version ~ '^(0|[1-9][0-9]*)$'),
  last_operation_fingerprint character(64),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id,payout_id),
  CHECK (payout_json::jsonb ->> 'payoutId'=payout_id),
  CHECK (last_operation_fingerprint IS NULL OR last_operation_fingerprint ~ '^[a-f0-9]{64}$')
);

ALTER TABLE dna.manual_tournament_payout_candidate_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.manual_tournament_payout_candidate_set FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.manual_tournament_payout_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.manual_tournament_payout_state FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.manual_tournament_payout_candidate_set
  USING (owner_id=dna.current_owner_id()) WITH CHECK (owner_id=dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.manual_tournament_payout_state
  USING (owner_id=dna.current_owner_id()) WITH CHECK (owner_id=dna.current_owner_id());

CREATE FUNCTION dna.read_manual_tournament_payout_write_context(p_owner_id uuid)
RETURNS TABLE(asset_registry_version text,assets_json text,ledger_version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $function$
  SELECT * FROM dna.read_manual_economic_write_context(p_owner_id)
$function$;

CREATE FUNCTION dna.publish_manual_tournament_payout_candidate_set(
  p_owner_id uuid,p_tournament_id text,p_occurred_at timestamptz,
  p_asset_code text,p_amount text,p_maximum_candidates integer,
  p_active_import_snapshot_hash character(64),
  p_candidate_set_hash character(64),p_canonical_envelope text,
  p_candidates_json text,p_expected_candidate_set_hash text
)
RETURNS TABLE(disposition text,active_import_snapshot_hash text,
  candidate_set_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  v_envelope jsonb;
  v_candidates jsonb;
  v_current character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped tournament payout candidate publication denied';
  END IF;
  v_envelope:=p_canonical_envelope::jsonb;
  v_candidates:=p_candidates_json::jsonb;
  IF nullif(btrim(p_tournament_id),'') IS NULL
    OR NOT isfinite(p_occurred_at)
    OR upper(p_asset_code)!~'^[A-Z][A-Z0-9_]{1,15}$'
    OR nullif(btrim(p_amount),'') IS NULL
    OR p_maximum_candidates NOT BETWEEN 1 AND 250
    OR p_active_import_snapshot_hash!~'^[a-f0-9]{64}$'
    OR p_candidate_set_hash!~'^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(p_canonical_envelope,'UTF8')),'hex')<>p_candidate_set_hash
    OR jsonb_typeof(v_candidates)<>'array'
    OR jsonb_array_length(v_candidates)>p_maximum_candidates
    OR v_envelope ->> 'activeImportSnapshotHash'<>p_active_import_snapshot_hash
    OR v_envelope -> 'candidates'<>v_candidates
    OR v_envelope #>> '{query,tournamentId}'<>p_tournament_id
    OR (v_envelope #>> '{query,occurredAt}')::timestamptz<>p_occurred_at
    OR upper(v_envelope #>> '{query,assetCode}')<>upper(p_asset_code)
    OR v_envelope #>> '{query,amount}'<>p_amount
    OR (v_envelope #>> '{query,maximumCandidates}')::integer<>p_maximum_candidates
  THEN RAISE EXCEPTION 'tournament payout candidate publication is invalid'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_candidates) candidate
    WHERE jsonb_typeof(candidate)<>'object'
      OR nullif(btrim(candidate ->> 'transactionId'),'') IS NULL
      OR (candidate ->> 'occurredAt')::timestamptz>clock_timestamp()
      OR candidate ->> 'stage' NOT IN ('qualification','round','final','unknown')
      OR upper(candidate ->> 'assetCode')!~'^[A-Z][A-Z0-9_]{1,15}$'
      OR nullif(btrim(candidate ->> 'amount'),'') IS NULL
      OR candidate ->> 'aggregateStatus' NOT IN ('included','excluded')
  ) OR (SELECT count(*) FROM jsonb_array_elements(v_candidates))<>
    (SELECT count(DISTINCT candidate ->> 'transactionId')
      FROM jsonb_array_elements(v_candidates) candidate)
  THEN RAISE EXCEPTION 'tournament payout candidates are invalid'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text||':'||p_tournament_id||':'||p_occurred_at::text||':'||
    upper(p_asset_code)||':'||p_amount||':'||p_maximum_candidates::text,0));

  SELECT candidate.candidate_set_hash INTO v_current
  FROM dna.manual_tournament_payout_candidate_set candidate
  WHERE candidate.owner_id=p_owner_id
    AND candidate.tournament_id=p_tournament_id
    AND candidate.occurred_at=p_occurred_at
    AND candidate.asset_code=upper(p_asset_code)
    AND candidate.amount=p_amount
    AND candidate.maximum_candidates=p_maximum_candidates
  FOR UPDATE;
  IF FOUND AND v_current=p_candidate_set_hash THEN
    RETURN QUERY SELECT 'already_exists',p_active_import_snapshot_hash::text,
      p_candidate_set_hash::text; RETURN;
  END IF;
  IF (v_current IS NULL AND nullif(p_expected_candidate_set_hash,'') IS NOT NULL)
    OR (v_current IS NOT NULL AND v_current::text IS DISTINCT FROM
      nullif(p_expected_candidate_set_hash,''))
  THEN
    RETURN QUERY SELECT 'version_conflict',NULL::text,v_current::text; RETURN;
  END IF;
  INSERT INTO dna.manual_tournament_payout_candidate_set(
    owner_id,tournament_id,occurred_at,asset_code,amount,maximum_candidates,
    active_import_snapshot_hash,candidate_set_hash,canonical_envelope,
    candidates_json,published_at
  ) VALUES(p_owner_id,p_tournament_id,p_occurred_at,upper(p_asset_code),p_amount,
    p_maximum_candidates,p_active_import_snapshot_hash,p_candidate_set_hash,
    p_canonical_envelope,p_candidates_json,clock_timestamp())
  ON CONFLICT(owner_id,tournament_id,occurred_at,asset_code,amount,maximum_candidates)
  DO UPDATE SET active_import_snapshot_hash=EXCLUDED.active_import_snapshot_hash,
    candidate_set_hash=EXCLUDED.candidate_set_hash,
    canonical_envelope=EXCLUDED.canonical_envelope,
    candidates_json=EXCLUDED.candidates_json,published_at=EXCLUDED.published_at;
  RETURN QUERY SELECT 'published',p_active_import_snapshot_hash::text,
    p_candidate_set_hash::text;
END
$function$;

CREATE FUNCTION dna.read_manual_tournament_payout_candidates(
  p_owner_id uuid,p_tournament_id text,p_occurred_at timestamptz,
  p_asset_code text,p_amount text,p_maximum_candidates integer
)
RETURNS TABLE(active_import_snapshot_hash text,candidate_set_hash text,candidates_json text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped tournament payout candidates denied';
  END IF;
  IF p_maximum_candidates NOT BETWEEN 1 AND 250 THEN
    RAISE EXCEPTION 'tournament payout candidate bound is invalid';
  END IF;
  RETURN QUERY SELECT candidate.active_import_snapshot_hash::text,
    candidate.candidate_set_hash::text,candidate.candidates_json
  FROM dna.manual_tournament_payout_candidate_set candidate
  WHERE candidate.owner_id=p_owner_id
    AND candidate.tournament_id=p_tournament_id
    AND candidate.occurred_at=p_occurred_at
    AND candidate.asset_code=upper(p_asset_code)
    AND candidate.amount=p_amount
    AND candidate.maximum_candidates=p_maximum_candidates;
  IF NOT FOUND THEN RAISE EXCEPTION 'accepted tournament payout candidate set unavailable'; END IF;
END
$function$;

CREATE FUNCTION dna.write_manual_tournament_payout(
  p_owner_id uuid,p_payout_id text,p_fingerprint character(64),p_payout_json text,
  p_reconciliation_json text,p_evidence_json text,p_expected_ledger_version text,
  p_operation_fingerprint text
)
RETURNS TABLE(disposition text,fingerprint text,ledger_version text,
  reconciliation_revision bigint,candidate_set_json text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  v_payout jsonb:=p_payout_json::jsonb;
  v_evidence jsonb:=p_evidence_json::jsonb;
  v_existing dna.manual_tournament_payout_state%ROWTYPE;
  v_entry text;
  v_entry_hash character(64);
  v_result record;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped tournament payout write denied';
  END IF;
  IF p_fingerprint IS NULL OR p_fingerprint!~'^[a-f0-9]{64}$'
    OR p_operation_fingerprint<>p_fingerprint
    OR v_payout ->> 'payoutId' IS DISTINCT FROM p_payout_id
    OR v_payout ->> 'sourceType' IS DISTINCT FROM 'manual_tournament_payout'
    OR v_payout ->> 'tournamentAggregationEligible' IS DISTINCT FROM 'true'
    OR v_payout ->> 'duplicateReviewRequired' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'manual tournament payout evidence is invalid'; END IF;
  SELECT * INTO v_existing FROM dna.manual_tournament_payout_state state
  WHERE state.owner_id=p_owner_id AND state.payout_id=p_payout_id;
  IF FOUND THEN
    RETURN QUERY SELECT CASE WHEN v_existing.state_fingerprint=p_fingerprint
      THEN 'already_exists' ELSE 'conflict' END,v_existing.state_fingerprint::text,
      v_existing.ledger_version,v_existing.reconciliation_revision,NULL::text;
    RETURN;
  END IF;
  PERFORM 1 FROM dna.manual_tournament_payout_candidate_set candidate
  WHERE candidate.owner_id=p_owner_id
    AND candidate.tournament_id=v_payout ->> 'tournamentId'
    AND candidate.occurred_at=(v_payout ->> 'occurredAt')::timestamptz
    AND candidate.asset_code=upper(v_payout ->> 'assetCode')
    AND candidate.amount=v_payout ->> 'amount'
    AND candidate.maximum_candidates=250
    AND candidate.active_import_snapshot_hash::text=v_evidence ->> 'activeImportSnapshotHash'
    AND candidate.candidate_set_hash::text=v_evidence ->> 'candidateSetHash'
    AND v_evidence -> 'candidateTransactionIds'=COALESCE((
      SELECT jsonb_agg(item.value ->> 'transactionId' ORDER BY item.ordinality)
      FROM jsonb_array_elements(candidate.candidates_json::jsonb)
        WITH ORDINALITY AS item(value,ordinality)
    ),'[]'::jsonb);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'evidence_conflict',NULL::text,
      COALESCE((SELECT source_revision::text FROM dna.vault_performance_summary_source_state
        WHERE owner_id=p_owner_id),'0'),0::bigint,NULL::text;
    RETURN;
  END IF;
  v_entry:=jsonb_build_object(
    'entryId',p_payout_id,'occurredAt',v_payout ->> 'occurredAt',
    'assetCode',v_payout ->> 'assetCode','assetKind',v_payout ->> 'assetKind',
    'assetPrecision',(v_payout ->> 'assetDecimalPlaces')::integer,
    'assetRegistryVersion',v_payout ->> 'assetRegistryVersion',
    'subcategory','manual_tournament_payout','externalReference',v_payout ->> 'externalReference',
    'note',v_payout ->> 'evidenceNote','postings',jsonb_build_array(jsonb_build_object(
      'postingId','tournament-payout','assetCode',v_payout ->> 'assetCode',
      'assetKind',v_payout ->> 'assetKind','signedAmount',v_payout ->> 'amount',
      'operating',true,'tournamentAggregationEligible',true)))::text;
  v_entry_hash:=encode(sha256(convert_to(v_entry,'UTF8')),'hex');
  SELECT * INTO v_result FROM dna.write_manual_economic_entry(
    p_owner_id,p_payout_id,v_entry_hash,v_entry,p_expected_ledger_version);
  IF v_result.disposition NOT IN ('created','already_exists') THEN
    RETURN QUERY SELECT v_result.disposition,NULL::text,v_result.ledger_version,
      0::bigint,NULL::text; RETURN;
  END IF;
  INSERT INTO dna.manual_tournament_payout_state(owner_id,payout_id,payout_json,
    state_fingerprint,reconciliation_json,reconciliation_evidence_json,
    ledger_version,last_operation_fingerprint)
  VALUES(p_owner_id,p_payout_id,p_payout_json,p_fingerprint,p_reconciliation_json,
    p_evidence_json,v_result.ledger_version,p_fingerprint);
  RETURN QUERY SELECT 'created',p_fingerprint::text,v_result.ledger_version,
    0::bigint,NULL::text;
END
$function$;

CREATE FUNCTION dna.read_manual_tournament_payout(p_owner_id uuid,p_payout_id text)
RETURNS TABLE(payout_json text,state_fingerprint text,reconciliation_json text,
  reconciliation_evidence_json text,reconciliation_revision bigint,
  ledger_version text,last_operation_fingerprint text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped tournament payout read denied';
  END IF;
  RETURN QUERY SELECT state.payout_json,state.state_fingerprint::text,
    state.reconciliation_json,state.reconciliation_evidence_json,
    state.reconciliation_revision,state.ledger_version,
    state.last_operation_fingerprint::text
  FROM dna.manual_tournament_payout_state state
  WHERE state.owner_id=p_owner_id AND state.payout_id=p_payout_id;
END
$function$;

CREATE FUNCTION dna.write_manual_tournament_payout_reconciliation(
  p_owner_id uuid,p_payout_id text,p_expected_revision bigint,
  p_fingerprint character(64),p_decision_json text,p_reconciliation_json text,
  p_evidence_json text,p_reopen boolean
)
RETURNS TABLE(disposition text,fingerprint text,ledger_version text,
  reconciliation_revision bigint,candidate_set_json text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  v_state dna.manual_tournament_payout_state%ROWTYPE;
  v_candidate dna.manual_tournament_payout_candidate_set%ROWTYPE;
  v_status text:=p_reconciliation_json::jsonb ->> 'status';
  v_revision bigint;
  v_ledger text;
  v_candidates text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped tournament payout reconciliation denied';
  END IF;
  SELECT * INTO v_state FROM dna.manual_tournament_payout_state state
  WHERE state.owner_id=p_owner_id AND state.payout_id=p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manual tournament payout unavailable'; END IF;
  IF v_state.reconciliation_revision<>p_expected_revision THEN
    RETURN QUERY SELECT 'revision_conflict',NULL::text,v_state.ledger_version,
      v_state.reconciliation_revision,NULL::text; RETURN;
  END IF;
  IF p_fingerprint!~'^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'tournament payout reconciliation fingerprint invalid';
  END IF;
  IF p_reopen THEN
    IF v_status<>'review_required' THEN RAISE EXCEPTION 'reopened review state invalid'; END IF;
  ELSIF v_status NOT IN ('confirmed_duplicate','confirmed_separate') THEN
    RAISE EXCEPTION 'tournament payout decision state invalid';
  END IF;
  SELECT candidate.* INTO v_candidate
  FROM dna.manual_tournament_payout_candidate_set candidate
  WHERE candidate.owner_id=p_owner_id
    AND candidate.tournament_id=v_state.payout_json::jsonb ->> 'tournamentId'
    AND candidate.occurred_at=(v_state.payout_json::jsonb ->> 'occurredAt')::timestamptz
    AND candidate.asset_code=upper(v_state.payout_json::jsonb ->> 'assetCode')
    AND candidate.amount=v_state.payout_json::jsonb ->> 'amount'
    AND candidate.maximum_candidates=250
    AND candidate.active_import_snapshot_hash::text=
      p_evidence_json::jsonb ->> 'activeImportSnapshotHash'
    AND candidate.candidate_set_hash::text=p_evidence_json::jsonb ->> 'candidateSetHash'
    AND p_evidence_json::jsonb -> 'candidateTransactionIds'=COALESCE((
      SELECT jsonb_agg(item.value ->> 'transactionId' ORDER BY item.ordinality)
      FROM jsonb_array_elements(candidate.candidates_json::jsonb)
        WITH ORDINALITY AS item(value,ordinality)
    ),'[]'::jsonb);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'evidence_conflict',NULL::text,v_state.ledger_version,
      v_state.reconciliation_revision,NULL::text;
    RETURN;
  END IF;
  UPDATE dna.economic_transaction transaction SET
    duplicate_status=CASE WHEN v_status='confirmed_duplicate' THEN 'excluded' ELSE 'clear' END,
    updated_at=clock_timestamp()
  WHERE transaction.owner_id=p_owner_id
    AND transaction.natural_key='manual-economic:'||p_payout_id||':tournament-payout';
  SELECT source_revision::text INTO v_ledger
  FROM dna.vault_performance_summary_source_state WHERE owner_id=p_owner_id;
  v_revision:=v_state.reconciliation_revision+1;
  UPDATE dna.manual_tournament_payout_state state SET
    reconciliation_json=p_reconciliation_json,
    reconciliation_evidence_json=p_evidence_json,
    reconciliation_revision=v_revision,ledger_version=v_ledger,
    last_operation_fingerprint=p_fingerprint,updated_at=clock_timestamp()
  WHERE state.owner_id=p_owner_id AND state.payout_id=p_payout_id;
  IF p_reopen THEN
    v_candidates:=jsonb_build_object(
      'activeImportSnapshotHash',v_candidate.active_import_snapshot_hash,
      'candidateSetHash',v_candidate.candidate_set_hash,
      'candidates',v_candidate.candidates_json::jsonb)::text;
  END IF;
  RETURN QUERY SELECT CASE WHEN p_reopen THEN 'review_reopened' ELSE 'created' END,
    p_fingerprint::text,v_ledger,v_revision,v_candidates;
END
$function$;

REVOKE ALL ON TABLE dna.manual_tournament_payout_candidate_set,
  dna.manual_tournament_payout_state FROM PUBLIC,dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_manual_tournament_payout_write_context(uuid),
  dna.publish_manual_tournament_payout_candidate_set(uuid,text,timestamptz,text,text,integer,character,character,text,text,text),
  dna.read_manual_tournament_payout_candidates(uuid,text,timestamptz,text,text,integer),
  dna.write_manual_tournament_payout(uuid,text,character,text,text,text,text,text),
  dna.read_manual_tournament_payout(uuid,text),
  dna.write_manual_tournament_payout_reconciliation(uuid,text,bigint,character,text,text,text,boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_manual_tournament_payout_write_context(uuid),
  dna.publish_manual_tournament_payout_candidate_set(uuid,text,timestamptz,text,text,integer,character,character,text,text,text),
  dna.read_manual_tournament_payout_candidates(uuid,text,timestamptz,text,text,integer),
  dna.write_manual_tournament_payout(uuid,text,character,text,text,text,text,text),
  dna.read_manual_tournament_payout(uuid,text),
  dna.write_manual_tournament_payout_reconciliation(uuid,text,bigint,character,text,text,text,boolean)
  TO dna_app_runtime;

COMMIT;

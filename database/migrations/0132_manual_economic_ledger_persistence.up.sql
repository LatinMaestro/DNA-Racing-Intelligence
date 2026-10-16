BEGIN;

CREATE TABLE dna.manual_economic_entry (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  entry_id text NOT NULL CHECK (
    length(entry_id) BETWEEN 8 AND 128 AND
    entry_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]+$'
  ),
  fingerprint character(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  entry_json text NOT NULL CHECK (
    octet_length(entry_json) BETWEEN 2 AND 262144 AND
    jsonb_typeof(entry_json::jsonb) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, entry_id),
  CHECK (fingerprint = encode(sha256(convert_to(entry_json, 'UTF8')), 'hex'))
);

CREATE TABLE dna.manual_economic_reversal (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  reversal_id text NOT NULL CHECK (
    length(reversal_id) BETWEEN 8 AND 128 AND
    reversal_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]+$'
  ),
  original_entry_id text NOT NULL,
  fingerprint character(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  reversal_json text NOT NULL CHECK (
    octet_length(reversal_json) BETWEEN 2 AND 262144 AND
    jsonb_typeof(reversal_json::jsonb) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, reversal_id),
  UNIQUE (owner_id, original_entry_id),
  FOREIGN KEY (owner_id, original_entry_id)
    REFERENCES dna.manual_economic_entry(owner_id, entry_id) ON DELETE RESTRICT,
  CHECK (fingerprint = encode(sha256(convert_to(reversal_json, 'UTF8')), 'hex'))
);

ALTER TABLE dna.manual_economic_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.manual_economic_entry FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.manual_economic_reversal ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.manual_economic_reversal FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.manual_economic_entry
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.manual_economic_reversal
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_manual_economic_write_context(p_owner_id uuid)
RETURNS TABLE (
  asset_registry_version text,
  assets_json text,
  ledger_version text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_assets jsonb;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped manual economic context denied';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
      'code', upper(asset.code),
      'kind', CASE asset.asset_kind
        WHEN 'bgc' THEN 'game_credit'
        WHEN 'fiat' THEN 'fiat'
        ELSE 'crypto'
      END,
      'precision', asset.atomic_scale
    ) ORDER BY upper(asset.code))
  INTO v_assets
  FROM dna.asset_currency asset
  WHERE asset.owner_id = p_owner_id;
  IF v_assets IS NULL OR jsonb_array_length(v_assets) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT
    encode(sha256(convert_to(v_assets::text, 'UTF8')), 'hex'),
    v_assets::text,
    COALESCE((
      SELECT state.source_revision::text
      FROM dna.vault_performance_summary_source_state state
      WHERE state.owner_id = p_owner_id
    ), '0');
END
$function$;

CREATE FUNCTION dna.read_manual_economic_tournament_binding(
  p_owner_id uuid,
  p_tournament_id text
)
RETURNS TABLE (
  tournament_id text,
  evidence_id text,
  configuration_version text,
  owner_acknowledged_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped tournament binding denied';
  END IF;
  IF nullif(btrim(p_tournament_id), '') IS NULL THEN
    RAISE EXCEPTION 'tournament binding identity is invalid';
  END IF;
  RETURN QUERY
  WITH accepted AS (
    SELECT configuration.tournament_id,
      configuration.campaign_action ->> 'evidence' AS evidence_id,
      configuration.configuration_version,
      (configuration.campaign_action ->> 'ownerAcknowledgedAt')::timestamptz
        AS owner_acknowledged_at
    FROM dna.tournament_configuration configuration
    WHERE configuration.owner_id = p_owner_id
      AND configuration.tournament_id = p_tournament_id
      AND configuration.campaign_action ->> 'kind' = 'configured'
      AND configuration.campaign_action ->> 'configurationVersion' =
        configuration.configuration_version
  ), unambiguous AS (
    SELECT * FROM accepted WHERE (SELECT count(*) FROM accepted) = 1
  )
  SELECT unambiguous.tournament_id, unambiguous.evidence_id,
    unambiguous.configuration_version, unambiguous.owner_acknowledged_at
  FROM unambiguous;
END
$function$;

CREATE FUNCTION dna.read_manual_economic_entry(
  p_owner_id uuid,
  p_entry_id text
)
RETURNS TABLE (entry_json text, fingerprint text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped manual economic entry read denied';
  END IF;
  RETURN QUERY SELECT entry.entry_json, entry.fingerprint::text
  FROM dna.manual_economic_entry entry
  WHERE entry.owner_id = p_owner_id AND entry.entry_id = p_entry_id;
END
$function$;

CREATE FUNCTION dna.write_manual_economic_entry(
  p_owner_id uuid,
  p_entry_id text,
  p_fingerprint character(64),
  p_entry_json text,
  p_expected_ledger_version text
)
RETURNS TABLE (
  disposition text,
  fingerprint text,
  ledger_version text,
  reversal_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_entry jsonb;
  v_existing character(64);
  v_revision bigint;
  v_assets jsonb;
  v_asset_version text;
  v_asset_id uuid;
  v_asset_code text;
  v_asset_kind text;
  v_precision smallint;
  v_posting jsonb;
  v_amount numeric;
  v_category text;
  v_subcategory text;
  v_transaction_id uuid;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped manual economic entry write denied';
  END IF;
  IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(p_entry_json, 'UTF8')), 'hex') <> p_fingerprint
  THEN
    RAISE EXCEPTION 'manual economic entry fingerprint is invalid';
  END IF;
  v_entry := p_entry_json::jsonb;
  IF jsonb_typeof(v_entry) <> 'object'
    OR v_entry ->> 'entryId' IS DISTINCT FROM p_entry_id
    OR jsonb_typeof(v_entry -> 'postings') <> 'array'
    OR jsonb_array_length(v_entry -> 'postings') NOT BETWEEN 1 AND 2
  THEN
    RAISE EXCEPTION 'manual economic entry is invalid';
  END IF;

  INSERT INTO dna.vault_performance_summary_source_state(
    owner_id, source_revision, source_ledger_sha256, source_claimed_at,
    invalidated_at
  ) VALUES (p_owner_id, 0, NULL, NULL, clock_timestamp())
  ON CONFLICT (owner_id) DO NOTHING;
  SELECT state.source_revision INTO v_revision
  FROM dna.vault_performance_summary_source_state state
  WHERE state.owner_id=p_owner_id FOR UPDATE;
  SELECT entry.fingerprint INTO v_existing
  FROM dna.manual_economic_entry entry
  WHERE entry.owner_id=p_owner_id AND entry.entry_id=p_entry_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      CASE WHEN v_existing=p_fingerprint THEN 'already_exists' ELSE 'conflict' END,
      v_existing::text,v_revision::text,NULL::text;
    RETURN;
  END IF;
  IF p_expected_ledger_version IS NULL
    OR p_expected_ledger_version !~ '^(0|[1-9][0-9]*)$'
    OR p_expected_ledger_version::numeric <> v_revision
  THEN
    RETURN QUERY SELECT 'version_conflict', NULL::text, v_revision::text,
      NULL::text;
    RETURN;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'code', upper(asset.code),
      'kind', CASE asset.asset_kind WHEN 'bgc' THEN 'game_credit'
        WHEN 'fiat' THEN 'fiat' ELSE 'crypto' END,
      'precision', asset.atomic_scale
    ) ORDER BY upper(asset.code))
  INTO v_assets FROM dna.asset_currency asset WHERE asset.owner_id=p_owner_id;
  v_asset_version := encode(sha256(convert_to(v_assets::text,'UTF8')),'hex');
  IF v_entry ->> 'assetRegistryVersion' IS DISTINCT FROM v_asset_version THEN
    RAISE EXCEPTION 'manual economic asset registry changed';
  END IF;
  v_asset_code := upper(v_entry ->> 'assetCode');
  SELECT asset.id, asset.atomic_scale,
    CASE asset.asset_kind WHEN 'bgc' THEN 'game_credit'
      WHEN 'fiat' THEN 'fiat' ELSE 'crypto' END
  INTO v_asset_id, v_precision, v_asset_kind
  FROM dna.asset_currency asset
  WHERE asset.owner_id=p_owner_id AND upper(asset.code)=v_asset_code;
  IF NOT FOUND OR v_entry ->> 'assetKind' IS DISTINCT FROM v_asset_kind
    OR (v_entry ->> 'assetPrecision')::integer <> v_precision
  THEN
    RAISE EXCEPTION 'manual economic asset evidence is invalid';
  END IF;

  v_subcategory := v_entry ->> 'subcategory';
  INSERT INTO dna.manual_economic_entry(owner_id,entry_id,fingerprint,entry_json)
  VALUES (p_owner_id,p_entry_id,p_fingerprint,p_entry_json);
  FOR v_posting IN SELECT value FROM jsonb_array_elements(v_entry -> 'postings')
  LOOP
    IF v_posting ->> 'assetCode' IS DISTINCT FROM v_asset_code
      OR v_posting ->> 'assetKind' IS DISTINCT FROM v_asset_kind
      OR nullif(btrim(v_posting ->> 'postingId'),'') IS NULL
    THEN RAISE EXCEPTION 'manual economic posting evidence is invalid'; END IF;
    v_amount := (v_posting ->> 'signedAmount')::numeric *
      power(10::numeric, v_precision);
    IF v_amount=0 OR trunc(v_amount)<>v_amount THEN
      RAISE EXCEPTION 'manual economic posting amount is invalid';
    END IF;
    v_category := CASE v_subcategory
      WHEN 'manual_tournament_payout' THEN
        CASE WHEN COALESCE((v_posting ->> 'tournamentAggregationEligible')::boolean,false)
          THEN 'manual_tournament_prize' ELSE 'unclassified' END
      WHEN 'breeding_fee_earned' THEN 'breeding_fee_earned'
      WHEN 'dna_base_fee' THEN 'dna_splice_fee'
      WHEN 'arena_owner_fee' THEN 'external_arena_fee'
      WHEN 'arena_fee_bgc' THEN 'bgc_arena_fee'
      WHEN 'core_purchase' THEN 'core_purchase'
      WHEN 'core_sale' THEN 'core_sale'
      WHEN 'marketplace_fee' THEN 'marketplace_fee'
      WHEN 'burn_bgc_credit' THEN 'bgc_burn_credit'
      WHEN 'deposit' THEN 'deposit'
      WHEN 'withdrawal' THEN 'withdrawal'
      WHEN 'internal_transfer' THEN 'internal_transfer'
      WHEN 'opening_balance' THEN 'opening_balance'
      WHEN 'adjustment' THEN 'reconciliation_adjustment'
      ELSE 'unclassified'
    END;
    v_transaction_id := md5(p_owner_id::text || ':manual-economic:' ||
      p_entry_id || ':' || (v_posting ->> 'postingId'))::uuid;
    INSERT INTO dna.economic_transaction(
      id,owner_id,natural_key,source_type,asset_currency_id,occurred_at,
      amount_atomic,direction,category,subcategory,operating_effect,
      classification_status,duplicate_status,external_reference,notes
    ) VALUES (
      v_transaction_id,p_owner_id,
      'manual-economic:' || p_entry_id || ':' || (v_posting ->> 'postingId'),
      'manual',v_asset_id,(v_entry ->> 'occurredAt')::timestamptz,v_amount,
      CASE WHEN v_amount>0 THEN 'credit' ELSE 'debit' END,
      v_category,v_subcategory,
      COALESCE((v_posting ->> 'operating')::boolean,false),
      CASE WHEN v_category='unclassified' THEN 'review_required' ELSE 'manual' END,
      'clear',nullif(v_entry ->> 'externalReference',''),
      nullif(v_entry ->> 'note','')
    );
  END LOOP;
  SELECT state.source_revision INTO v_revision
  FROM dna.vault_performance_summary_source_state state
  WHERE state.owner_id=p_owner_id;
  RETURN QUERY SELECT 'created',p_fingerprint::text,v_revision::text,NULL::text;
END
$function$;

CREATE FUNCTION dna.write_manual_economic_reversal(
  p_owner_id uuid,
  p_reversal_id text,
  p_original_entry_id text,
  p_fingerprint character(64),
  p_reversal_json text,
  p_expected_original_fingerprint character(64),
  p_expected_ledger_version text
)
RETURNS TABLE (
  disposition text,
  fingerprint text,
  ledger_version text,
  reversal_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_reversal jsonb;
  v_existing dna.manual_economic_reversal%ROWTYPE;
  v_original dna.manual_economic_entry%ROWTYPE;
  v_revision bigint;
  v_posting jsonb;
  v_original_transaction dna.economic_transaction%ROWTYPE;
  v_amount numeric;
  v_transaction_id uuid;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped manual economic reversal denied';
  END IF;
  IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(p_reversal_json,'UTF8')),'hex')<>p_fingerprint
  THEN RAISE EXCEPTION 'manual economic reversal fingerprint is invalid'; END IF;
  v_reversal := p_reversal_json::jsonb;
  IF v_reversal ->> 'reversalId' IS DISTINCT FROM p_reversal_id
    OR v_reversal ->> 'originalEntryId' IS DISTINCT FROM p_original_entry_id
    OR jsonb_typeof(v_reversal -> 'postings') <> 'array'
  THEN RAISE EXCEPTION 'manual economic reversal is invalid'; END IF;

  SELECT state.source_revision INTO v_revision
  FROM dna.vault_performance_summary_source_state state
  WHERE state.owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual economic ledger state unavailable';
  END IF;

  SELECT * INTO v_existing FROM dna.manual_economic_reversal reversal
  WHERE reversal.owner_id=p_owner_id AND reversal.reversal_id=p_reversal_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      CASE WHEN v_existing.fingerprint=p_fingerprint THEN 'already_exists'
        ELSE 'conflict' END,
      v_existing.fingerprint::text,
      v_revision::text,
      v_existing.reversal_id;
    RETURN;
  END IF;
  SELECT * INTO v_original FROM dna.manual_economic_entry entry
  WHERE entry.owner_id=p_owner_id AND entry.entry_id=p_original_entry_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manual economic original unavailable'; END IF;
  IF v_original.fingerprint IS DISTINCT FROM p_expected_original_fingerprint THEN
    RETURN QUERY SELECT 'original_changed',v_original.fingerprint::text,
      v_revision::text,NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_existing FROM dna.manual_economic_reversal reversal
  WHERE reversal.owner_id=p_owner_id
    AND reversal.original_entry_id=p_original_entry_id;
  IF FOUND THEN
    RETURN QUERY SELECT 'original_already_reversed',v_existing.fingerprint::text,
      v_revision::text,v_existing.reversal_id;
    RETURN;
  END IF;
  IF p_expected_ledger_version IS NULL
    OR p_expected_ledger_version !~ '^(0|[1-9][0-9]*)$'
    OR p_expected_ledger_version::numeric<>v_revision
  THEN
    RETURN QUERY SELECT 'version_conflict',NULL::text,v_revision::text,NULL::text;
    RETURN;
  END IF;
  INSERT INTO dna.manual_economic_reversal(
    owner_id,reversal_id,original_entry_id,fingerprint,reversal_json
  ) VALUES (
    p_owner_id,p_reversal_id,p_original_entry_id,p_fingerprint,p_reversal_json
  );
  FOR v_posting IN SELECT value FROM jsonb_array_elements(v_reversal -> 'postings')
  LOOP
    SELECT transaction.* INTO v_original_transaction
    FROM dna.economic_transaction transaction
    WHERE transaction.owner_id=p_owner_id AND transaction.natural_key=
      'manual-economic:' || p_original_entry_id || ':' ||
        (v_posting ->> 'originalPostingId');
    IF NOT FOUND THEN RAISE EXCEPTION 'manual economic original posting unavailable'; END IF;
    v_amount := (v_posting ->> 'signedAmount')::numeric *
      power(10::numeric,(v_original.entry_json::jsonb ->> 'assetPrecision')::integer);
    IF v_amount<>-v_original_transaction.amount_atomic THEN
      RAISE EXCEPTION 'manual economic reversal amount is invalid';
    END IF;
    v_transaction_id := md5(p_owner_id::text || ':manual-economic-reversal:' ||
      p_reversal_id || ':' || (v_posting ->> 'postingId'))::uuid;
    INSERT INTO dna.economic_transaction(
      id,owner_id,natural_key,source_type,asset_currency_id,occurred_at,
      amount_atomic,direction,category,subcategory,operating_effect,
      classification_status,duplicate_status,external_reference,notes,
      reverses_transaction_id
    ) VALUES (
      v_transaction_id,p_owner_id,
      'manual-economic-reversal:' || p_reversal_id || ':' ||
        (v_posting ->> 'postingId'),
      'reversal',v_original_transaction.asset_currency_id,
      (v_reversal ->> 'reversedAt')::timestamptz,v_amount,
      CASE WHEN v_amount>0 THEN 'credit' ELSE 'debit' END,
      v_original_transaction.category,v_original_transaction.subcategory,
      v_original_transaction.operating_effect,
      v_original_transaction.classification_status,'clear',
      v_original_transaction.external_reference,
      nullif(v_reversal ->> 'reason',''),v_original_transaction.id
    );
  END LOOP;
  SELECT state.source_revision INTO v_revision
  FROM dna.vault_performance_summary_source_state state
  WHERE state.owner_id=p_owner_id;
  RETURN QUERY SELECT 'created',p_fingerprint::text,v_revision::text,
    p_reversal_id;
END
$function$;

REVOKE ALL ON TABLE dna.manual_economic_entry
  FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON TABLE dna.manual_economic_reversal
  FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_manual_economic_write_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_manual_economic_tournament_binding(uuid,text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_manual_economic_entry(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.write_manual_economic_entry(
  uuid,text,character,text,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.write_manual_economic_reversal(
  uuid,text,text,character,text,character,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_manual_economic_write_context(uuid)
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_manual_economic_tournament_binding(uuid,text)
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_manual_economic_entry(uuid,text)
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.write_manual_economic_entry(
  uuid,text,character,text,text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.write_manual_economic_reversal(
  uuid,text,text,character,text,character,text
) TO dna_app_runtime;

COMMIT;

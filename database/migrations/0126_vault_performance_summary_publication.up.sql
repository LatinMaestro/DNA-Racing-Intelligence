BEGIN;

-- Compact invalidation authority for the accepted economic source. Routine
-- page reads use this one-row identity and never traverse the ledger.
CREATE TABLE dna.vault_performance_summary_source_state (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
  source_ledger_sha256 text CHECK (
    source_ledger_sha256 IS NULL OR
    source_ledger_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_claimed_at timestamptz CHECK (
    source_claimed_at IS NULL OR isfinite(source_claimed_at)
  ),
  invalidated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (
    isfinite(invalidated_at)
  ),
  CHECK ((source_ledger_sha256 IS NULL) = (source_claimed_at IS NULL))
);

ALTER TABLE dna.vault_performance_summary_source_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.vault_performance_summary_source_state FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.vault_performance_summary_source_state
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.invalidate_vault_performance_summary_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_owner_id := OLD.owner_id;
  ELSE
    v_owner_id := NEW.owner_id;
  END IF;
  INSERT INTO dna.vault_performance_summary_source_state (
    owner_id, source_revision, source_ledger_sha256, source_claimed_at,
    invalidated_at
  ) VALUES (
    v_owner_id, 1, NULL, NULL, clock_timestamp()
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    source_revision = dna.vault_performance_summary_source_state.source_revision + 1,
    source_ledger_sha256 = NULL,
    source_claimed_at = NULL,
    invalidated_at = clock_timestamp();
  IF TG_OP = 'UPDATE' AND OLD.owner_id IS DISTINCT FROM NEW.owner_id THEN
    INSERT INTO dna.vault_performance_summary_source_state (
      owner_id, source_revision, source_ledger_sha256, source_claimed_at,
      invalidated_at
    ) VALUES (
      OLD.owner_id, 1, NULL, NULL, clock_timestamp()
    )
    ON CONFLICT (owner_id) DO UPDATE SET
      source_revision = dna.vault_performance_summary_source_state.source_revision + 1,
      source_ledger_sha256 = NULL,
      source_claimed_at = NULL,
      invalidated_at = clock_timestamp();
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER invalidate_vault_performance_summary_on_transaction
AFTER INSERT OR UPDATE OR DELETE ON dna.economic_transaction
FOR EACH ROW EXECUTE FUNCTION dna.invalidate_vault_performance_summary_source();

CREATE TRIGGER invalidate_vault_performance_summary_on_asset
AFTER INSERT OR UPDATE OR DELETE ON dna.asset_currency
FOR EACH ROW EXECUTE FUNCTION dna.invalidate_vault_performance_summary_source();

CREATE TRIGGER invalidate_vault_performance_summary_on_reconciliation
AFTER INSERT OR UPDATE OR DELETE ON dna.reconciliation_issue
FOR EACH ROW EXECUTE FUNCTION dna.invalidate_vault_performance_summary_source();

CREATE TRIGGER invalidate_vault_performance_summary_on_import
AFTER INSERT OR UPDATE OR DELETE ON dna.import_batch
FOR EACH ROW EXECUTE FUNCTION dna.invalidate_vault_performance_summary_source();

-- This operator-only read returns the complete accepted accounting input in a
-- deterministic order. It is for bounded materialization, never page render.
-- Unsupported canonical categories are counted so the adapter can fail closed
-- instead of inventing a reporting treatment.
CREATE FUNCTION dna.read_vault_performance_canonical_source(p_owner_id uuid)
RETURNS TABLE (
  source_revision bigint,
  records_json jsonb,
  coverage_json jsonb,
  unsupported_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_revision bigint;
  v_records jsonb;
  v_unsupported bigint;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_data_current_through timestamptz;
  v_last_imported timestamptz;
  v_cost_basis jsonb;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Vault Performance source read denied';
  END IF;

  SELECT state.source_revision INTO v_revision
  FROM dna.vault_performance_summary_source_state state
  WHERE state.owner_id = p_owner_id;
  v_revision := COALESCE(v_revision, 0);

  WITH mapped AS (
    SELECT
      transaction.id,
      transaction.occurred_at,
      upper(asset.code) AS asset_code,
      CASE asset.asset_kind
        WHEN 'bgc' THEN 'game_credit'
        WHEN 'fiat' THEN 'fiat'
        ELSE 'crypto'
      END AS asset_kind,
      trim_scale(transaction.amount_atomic /
        power(10::numeric, asset.atomic_scale))::text AS signed_amount,
      CASE transaction.category
        WHEN 'open_race_entry_fee' THEN 'open_race_entry_fee'
        WHEN 'open_race_payout' THEN 'open_race_payout'
        WHEN 'tournament_qualification_entry_fee' THEN 'qualification_entry_fee'
        WHEN 'tournament_qualification_payout' THEN 'qualification_race_payout'
        WHEN 'tournament_round_payout' THEN 'tournament_round_payout'
        WHEN 'tournament_final_payout' THEN 'tournament_final_payout'
        WHEN 'manual_tournament_prize' THEN 'manual_tournament_payout'
        WHEN 'breeding_fee_earned' THEN 'breeding_fee_earned'
        WHEN 'dna_splice_fee' THEN 'breeding_expense'
        WHEN 'external_arena_fee' THEN 'breeding_expense'
        WHEN 'bgc_arena_fee' THEN 'arena_bgc_spend'
        WHEN 'core_purchase' THEN 'core_purchase'
        WHEN 'core_mint' THEN 'core_purchase'
        WHEN 'core_sale' THEN 'core_sale'
        WHEN 'marketplace_fee' THEN 'selling_fee'
        WHEN 'bgc_burn_credit' THEN 'burn_bgc_credit'
        WHEN 'deposit' THEN 'deposit'
        WHEN 'withdrawal' THEN 'withdrawal'
        WHEN 'internal_transfer' THEN 'internal_transfer'
        WHEN 'opening_balance' THEN 'opening_balance'
        WHEN 'reconciliation_adjustment' THEN 'reconciliation_adjustment'
        ELSE NULL
      END AS mapped_category,
      transaction.operating_effect,
      CASE transaction.duplicate_status
        WHEN 'excluded' THEN 'excluded'
        ELSE 'included'
      END AS aggregate_status,
      CASE transaction.classification_status
        WHEN 'inferred' THEN 'inferred'
        WHEN 'review_required' THEN 'unclassified'
        ELSE 'confirmed'
      END AS classification_status,
      CASE WHEN
        transaction.duplicate_status = 'potential_duplicate'
        OR transaction.classification_status = 'review_required'
        OR EXISTS (
          SELECT 1 FROM dna.reconciliation_issue issue
          WHERE issue.owner_id = transaction.owner_id
            AND issue.entity_id = transaction.id
            AND issue.status = 'open'
        )
      THEN 'review_required' ELSE 'reconciled' END AS reconciliation_status,
      transaction.category AS source_category,
      transaction.amount_atomic
    FROM dna.economic_transaction transaction
    JOIN dna.asset_currency asset
      ON asset.owner_id = transaction.owner_id
      AND asset.id = transaction.asset_currency_id
    WHERE transaction.owner_id = p_owner_id
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'transactionId', mapped.id::text,
        'occurredAt', to_char(mapped.occurred_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'assetCode', mapped.asset_code,
        'assetKind', mapped.asset_kind,
        'signedAmount', mapped.signed_amount,
        'category', mapped.mapped_category,
        'operating', mapped.operating_effect,
        'aggregateStatus', mapped.aggregate_status,
        'classificationStatus', mapped.classification_status,
        'reconciliationStatus', mapped.reconciliation_status
      ) ORDER BY mapped.occurred_at, mapped.id
    ) FILTER (
      WHERE mapped.mapped_category IS NOT NULL
        AND mapped.amount_atomic <> 0
    ), '[]'::jsonb),
    count(*) FILTER (
      WHERE mapped.mapped_category IS NULL
        AND mapped.source_category <> 'burn_event'
    ),
    min(mapped.occurred_at) FILTER (
      WHERE mapped.mapped_category IS NOT NULL
        AND mapped.amount_atomic <> 0
    ),
    max(mapped.occurred_at) FILTER (
      WHERE mapped.mapped_category IS NOT NULL
        AND mapped.amount_atomic <> 0
    )
  INTO v_records, v_unsupported, v_period_start, v_period_end
  FROM mapped;

  SELECT
    max(batch.dataset_current_through_after_import),
    max(batch.import_completed_at)
  INTO v_data_current_through, v_last_imported
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.status = 'accepted';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'assetCode', sale.asset_code,
      'status', 'missing_or_unconvertible'
    ) ORDER BY sale.asset_code
  ), '[]'::jsonb)
  INTO v_cost_basis
  FROM (
    SELECT DISTINCT upper(asset.code) AS asset_code
    FROM dna.economic_transaction transaction
    JOIN dna.asset_currency asset
      ON asset.owner_id = transaction.owner_id
      AND asset.id = transaction.asset_currency_id
    WHERE transaction.owner_id = p_owner_id
      AND transaction.category = 'core_sale'
      AND transaction.duplicate_status <> 'excluded'
  ) sale;

  RETURN QUERY SELECT
    v_revision,
    v_records,
    CASE WHEN v_period_start IS NULL THEN NULL ELSE jsonb_build_object(
      'periodStart', to_char(v_period_start AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'periodEnd', to_char(GREATEST(v_period_end,
        v_data_current_through) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'sourceCoverage', 'unknown',
      'manualTournamentPayoutStatus', 'unknown',
      'costBasisByAsset', v_cost_basis,
      'dataCurrentThrough', CASE WHEN v_data_current_through IS NULL THEN NULL
        ELSE to_jsonb(to_char(v_data_current_through AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END,
      'lastImported', CASE WHEN v_last_imported IS NULL THEN NULL
        ELSE to_jsonb(to_char(v_last_imported AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END,
      'freshnessState', 'unknown'
    ) END,
    v_unsupported;
END
$function$;

CREATE FUNCTION dna.claim_vault_performance_source_identity(
  p_owner_id uuid,
  p_expected_revision bigint,
  p_source_ledger_sha256 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_rows bigint;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Vault Performance source claim denied';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_source_ledger_sha256 IS NULL
    OR p_source_ledger_sha256 !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Vault Performance source claim is invalid';
  END IF;

  INSERT INTO dna.vault_performance_summary_source_state (
    owner_id, source_revision, source_ledger_sha256, source_claimed_at,
    invalidated_at
  ) VALUES (
    p_owner_id, p_expected_revision, p_source_ledger_sha256,
    clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    source_ledger_sha256 = EXCLUDED.source_ledger_sha256,
    source_claimed_at = EXCLUDED.source_claimed_at
  WHERE dna.vault_performance_summary_source_state.source_revision =
    p_expected_revision;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

CREATE FUNCTION dna.read_vault_performance_source_identity(p_owner_id uuid)
RETURNS TABLE (source_ledger_sha256 text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Vault Performance source identity denied';
  END IF;
  RETURN QUERY
    SELECT state.source_ledger_sha256
    FROM dna.vault_performance_summary_source_state state
    WHERE state.owner_id = p_owner_id
      AND state.source_ledger_sha256 IS NOT NULL;
END
$function$;

CREATE FUNCTION dna.publish_vault_performance_summary_snapshot(
  p_owner_id uuid,
  p_expected_source_ledger_sha256 text,
  p_materialized_at timestamptz,
  p_snapshot_json text,
  p_snapshot_sha256 text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_source text;
  v_existing_source text;
  v_existing_snapshot text;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Vault Performance publication denied';
  END IF;
  IF p_expected_source_ledger_sha256 IS NULL
    OR p_expected_source_ledger_sha256 !~ '^[a-f0-9]{64}$'
    OR p_snapshot_sha256 IS NULL
    OR p_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    OR p_materialized_at IS NULL
    OR NOT isfinite(p_materialized_at)
    OR p_materialized_at > clock_timestamp()
  THEN
    RAISE EXCEPTION 'Vault Performance publication candidate is invalid';
  END IF;

  SELECT state.source_ledger_sha256 INTO v_source
  FROM dna.vault_performance_summary_source_state state
  WHERE state.owner_id = p_owner_id
  FOR UPDATE;
  IF v_source IS DISTINCT FROM p_expected_source_ledger_sha256 THEN
    RETURN 'source_changed';
  END IF;

  SELECT snapshot.source_ledger_sha256, snapshot.snapshot_sha256
  INTO v_existing_source, v_existing_snapshot
  FROM dna.vault_performance_summary_snapshot snapshot
  WHERE snapshot.owner_id = p_owner_id;
  IF v_existing_source IS NOT DISTINCT FROM p_expected_source_ledger_sha256
    AND v_existing_snapshot IS NOT DISTINCT FROM p_snapshot_sha256
  THEN
    RETURN 'unchanged';
  END IF;

  INSERT INTO dna.vault_performance_summary_snapshot (
    owner_id, source_ledger_sha256, snapshot_sha256, materialized_at,
    snapshot_json
  ) VALUES (
    p_owner_id, p_expected_source_ledger_sha256, p_snapshot_sha256,
    p_materialized_at, p_snapshot_json
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    source_ledger_sha256 = EXCLUDED.source_ledger_sha256,
    snapshot_sha256 = EXCLUDED.snapshot_sha256,
    materialized_at = EXCLUDED.materialized_at,
    snapshot_json = EXCLUDED.snapshot_json;
  RETURN 'published';
END
$function$;

REVOKE ALL ON TABLE dna.vault_performance_summary_source_state
  FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.invalidate_vault_performance_summary_source()
  FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_vault_performance_canonical_source(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.claim_vault_performance_source_identity(uuid,bigint,text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_vault_performance_source_identity(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_vault_performance_summary_snapshot(uuid,text,timestamptz,text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_vault_performance_canonical_source(uuid)
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.claim_vault_performance_source_identity(uuid,bigint,text)
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_vault_performance_source_identity(uuid)
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_vault_performance_summary_snapshot(uuid,text,timestamptz,text,text)
  TO dna_app_runtime;

COMMIT;

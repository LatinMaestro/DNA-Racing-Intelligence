BEGIN;

ALTER TABLE dna.normalized_race_staged_fact
  ADD COLUMN payout_mechanism_source_value text,
  ADD COLUMN race_tags_source_value text;

UPDATE dna.normalized_race_staged_fact
SET payout_mechanism_source_value = raw_payout
WHERE payout_mechanism_source_value IS NULL;

ALTER TABLE dna.race_event
  ADD COLUMN payout_mechanism_source_value text,
  ADD COLUMN race_tags_source_value text;

CREATE TABLE dna.asset_daily_usd_rate (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  asset_currency_id uuid NOT NULL,
  rate_date date NOT NULL,
  usd_per_asset numeric(78, 30) NOT NULL CHECK (usd_per_asset > 0),
  source_rate_value text NOT NULL CHECK (
    source_rate_value ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
  ),
  provider text NOT NULL CHECK (provider IN ('coingecko', 'manual')),
  series_id text NOT NULL CHECK (NULLIF(btrim(series_id), '') IS NOT NULL),
  source_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('available', 'manual_override')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, asset_currency_id, rate_date),
  FOREIGN KEY (owner_id, asset_currency_id)
    REFERENCES dna.asset_currency(owner_id, id) ON DELETE RESTRICT,
  CHECK ((source_at AT TIME ZONE 'UTC')::date = rate_date),
  CHECK (
    (provider = 'coingecko' AND status = 'available')
    OR (provider = 'manual' AND status = 'manual_override')
  )
);

CREATE TABLE dna.economic_transaction_usd_valuation (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  economic_transaction_id uuid NOT NULL,
  daily_usd_rate_id uuid NOT NULL,
  signed_asset_amount numeric(78, 30) NOT NULL CHECK (
    signed_asset_amount <> 0
  ),
  converted_usd_amount numeric(78, 30) NOT NULL CHECK (
    converted_usd_amount <> 0
  ),
  valuation_status text NOT NULL CHECK (
    valuation_status IN ('available', 'manual_override')
  ),
  valued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, economic_transaction_id),
  FOREIGN KEY (owner_id, economic_transaction_id)
    REFERENCES dna.economic_transaction(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, daily_usd_rate_id)
    REFERENCES dna.asset_daily_usd_rate(owner_id, id) ON DELETE RESTRICT,
  CHECK (
    (signed_asset_amount < 0 AND converted_usd_amount < 0)
    OR (signed_asset_amount > 0 AND converted_usd_amount > 0)
  )
);

ALTER TABLE dna.asset_daily_usd_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.asset_daily_usd_rate FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.asset_daily_usd_rate
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.economic_transaction_usd_valuation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.economic_transaction_usd_valuation FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.economic_transaction_usd_valuation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE VIEW dna.race_economic_usd_coverage
WITH (security_invoker = true)
AS
SELECT
  transaction.owner_id,
  transaction.id AS economic_transaction_id,
  transaction.import_batch_id,
  transaction.race_entry_id,
  asset.code AS asset_code,
  transaction.occurred_at,
  transaction.amount_atomic,
  transaction.direction,
  transaction.subcategory,
  rate.rate_date,
  rate.usd_per_asset,
  valuation.converted_usd_amount,
  COALESCE(valuation.valuation_status, 'unavailable') AS valuation_status
FROM dna.economic_transaction transaction
JOIN dna.asset_currency asset
  ON asset.owner_id = transaction.owner_id
  AND asset.id = transaction.asset_currency_id
LEFT JOIN dna.economic_transaction_usd_valuation valuation
  ON valuation.owner_id = transaction.owner_id
  AND valuation.economic_transaction_id = transaction.id
LEFT JOIN dna.asset_daily_usd_rate rate
  ON rate.owner_id = valuation.owner_id
  AND rate.id = valuation.daily_usd_rate_id
WHERE
  transaction.source_type = 'race_derived'
  AND transaction.subcategory IN ('race_entry_fee', 'race_prize');

CREATE FUNCTION dna.accept_daily_usd_rate(
  p_asset_code text,
  p_rate_date date,
  p_source_rate_value text,
  p_provider text,
  p_series_id text,
  p_source_at timestamptz,
  p_retrieved_at timestamptz,
  p_status text
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_asset dna.asset_currency%ROWTYPE;
  v_rate_id uuid;
  v_existing dna.asset_daily_usd_rate%ROWTYPE;
  v_expected_series text;
  v_rate numeric(78, 30);
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for daily USD rates';
  END IF;

  IF upper(btrim(p_asset_code)) NOT IN ('ETH', 'DEZ') THEN
    RAISE EXCEPTION 'race USD rates support ETH and DEZ only';
  END IF;

  SELECT *
  INTO v_asset
  FROM dna.asset_currency
  WHERE owner_id = v_owner_id AND upper(code) = upper(btrim(p_asset_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped asset currency is not configured';
  END IF;

  IF p_source_rate_value IS NULL
    OR p_source_rate_value !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
  THEN
    RAISE EXCEPTION 'USD rate must be a plain non-negative decimal';
  END IF;

  v_rate := p_source_rate_value::numeric;
  IF v_rate <= 0 THEN
    RAISE EXCEPTION 'USD rate must be greater than zero';
  END IF;

  IF (p_source_at AT TIME ZONE 'UTC')::date <> p_rate_date THEN
    RAISE EXCEPTION 'USD rate source timestamp must match its UTC rate date';
  END IF;

  IF p_provider = 'coingecko' THEN
    v_expected_series := CASE upper(v_asset.code)
      WHEN 'ETH' THEN 'coingecko:coin:ethereum'
      WHEN 'DEZ' THEN
        'coingecko:polygon-pos:contract:0xdc4f4ed9872571d5ec8986a502a0d88f3a175f1e'
    END;
    IF p_status <> 'available' OR p_series_id <> v_expected_series THEN
      RAISE EXCEPTION 'CoinGecko provider/status/series does not match the asset';
    END IF;
  ELSIF p_provider = 'manual' THEN
    IF p_status <> 'manual_override'
      OR NULLIF(btrim(p_series_id), '') IS NULL
    THEN
      RAISE EXCEPTION 'manual rates require a series and manual_override status';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported USD rate provider';
  END IF;

  SELECT *
  INTO v_existing
  FROM dna.asset_daily_usd_rate
  WHERE
    owner_id = v_owner_id
    AND asset_currency_id = v_asset.id
    AND rate_date = p_rate_date;

  IF FOUND THEN
    IF v_existing.usd_per_asset <> v_rate
      OR v_existing.source_rate_value <> p_source_rate_value
      OR v_existing.provider <> p_provider
      OR v_existing.series_id <> p_series_id
      OR v_existing.source_at <> p_source_at
      OR v_existing.retrieved_at <> p_retrieved_at
      OR v_existing.status <> p_status
    THEN
      RAISE EXCEPTION 'daily USD rate conflicts with accepted immutable evidence';
    END IF;
    RETURN v_existing.id;
  END IF;

  v_rate_id := md5(
    v_owner_id::text || ':daily_usd_rate:' || v_asset.id::text || ':'
    || p_rate_date::text
  )::uuid;

  INSERT INTO dna.asset_daily_usd_rate (
    id, owner_id, asset_currency_id, rate_date, usd_per_asset,
    source_rate_value, provider, series_id, source_at, retrieved_at, status
  )
  VALUES (
    v_rate_id, v_owner_id, v_asset.id, p_rate_date, v_rate,
    p_source_rate_value, p_provider, p_series_id,
    p_source_at, p_retrieved_at, p_status
  );

  RETURN v_rate_id;
END
$function$;

CREATE FUNCTION dna.materialize_race_economics(
  p_import_batch_id uuid,
  p_materialized_at timestamptz
)
RETURNS TABLE (
  materialized_transaction_count bigint,
  validated_entry_count bigint,
  invalid_entry_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_batch dna.import_batch%ROWTYPE;
  v_fact record;
  v_asset dna.asset_currency%ROWTYPE;
  v_fee numeric;
  v_prize numeric;
  v_fee_atomic numeric(78, 0);
  v_prize_atomic numeric(78, 0);
  v_inserted bigint := 0;
  v_validated bigint := 0;
  v_invalid bigint := 0;
  v_row_count bigint;
  v_fee_scale integer;
  v_prize_scale integer;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for race economics';
  END IF;

  SELECT *
  INTO v_batch
  FROM dna.import_batch
  WHERE owner_id = v_owner_id AND id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND OR v_batch.source_type <> 'race_merge'
    OR v_batch.status <> 'accepted'
  THEN
    RAISE EXCEPTION 'accepted owner-scoped Race Merge batch does not exist';
  END IF;

  WITH consistent_event AS (
    SELECT
      fact.source_event_id,
      min(NULLIF(btrim(COALESCE(
        fact.payout_mechanism_source_value,
        fact.raw_payout
      )), '')) AS payout_mechanism_source_value,
      min(NULLIF(btrim(fact.race_tags_source_value), ''))
        AS race_tags_source_value
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
    GROUP BY fact.source_event_id
    HAVING
      count(DISTINCT NULLIF(btrim(COALESCE(
        fact.payout_mechanism_source_value,
        fact.raw_payout
      )), '')) <= 1
      AND count(DISTINCT NULLIF(btrim(fact.race_tags_source_value), '')) <= 1
  )
  UPDATE dna.race_event event
  SET
    payout_mechanism_source_value =
      consistent_event.payout_mechanism_source_value,
    race_tags_source_value = consistent_event.race_tags_source_value,
    updated_at = p_materialized_at
  FROM consistent_event
  WHERE
    event.owner_id = v_owner_id
    AND event.source_event_id = consistent_event.source_event_id;

  FOR v_fact IN
    SELECT
      fact.*,
      event.id AS race_event_id,
      event.event_at,
      entry.id AS race_entry_id
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
      AND staged.status = 'ready'
    JOIN dna.race_event event
      ON event.owner_id = fact.owner_id
      AND event.source_event_id = fact.source_event_id
      AND event.active_in_dataset
    JOIN dna.race_entry entry
      ON entry.owner_id = event.owner_id
      AND entry.race_event_id = event.id
      AND entry.source_core_id = fact.source_core_id
      AND entry.active_in_dataset
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
    ORDER BY fact.source_row_number
  LOOP
    SELECT *
    INTO v_asset
    FROM dna.asset_currency
    WHERE
      owner_id = v_owner_id
      AND upper(code) = upper(btrim(v_fact.raw_asset))
      AND upper(code) IN ('ETH', 'DEZ');

    v_fee_scale := CASE
      WHEN strpos(COALESCE(v_fact.raw_entry_fee, ''), '.') = 0 THEN 0
      ELSE length(split_part(v_fact.raw_entry_fee, '.', 2))
    END;
    v_prize_scale := CASE
      WHEN strpos(COALESCE(v_fact.raw_prize, ''), '.') = 0 THEN 0
      ELSE length(split_part(v_fact.raw_prize, '.', 2))
    END;

    IF NOT FOUND
      OR v_fact.raw_entry_fee IS NULL
      OR v_fact.raw_entry_fee !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      OR v_fact.raw_prize IS NULL
      OR v_fact.raw_prize !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      OR v_fee_scale > v_asset.atomic_scale
      OR v_prize_scale > v_asset.atomic_scale
    THEN
      UPDATE dna.race_entry
      SET economic_data_status = 'invalid', updated_at = p_materialized_at
      WHERE owner_id = v_owner_id AND id = v_fact.race_entry_id;

      INSERT INTO dna.reconciliation_issue (
        id, owner_id, issue_type, entity_type, entity_id,
        reason_code, created_at, updated_at
      )
      VALUES (
        md5(
          v_owner_id::text || ':race_economics_invalid:'
          || v_fact.race_entry_id::text
        )::uuid,
        v_owner_id, 'economic_classification', 'race_entry',
        v_fact.race_entry_id, 'INVALID_RACE_ECONOMICS',
        p_materialized_at, p_materialized_at
      )
      ON CONFLICT (owner_id, id) DO NOTHING;

      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    v_fee := v_fact.raw_entry_fee::numeric;
    v_prize := v_fact.raw_prize::numeric;
    v_fee_atomic := v_fee * power(10::numeric, v_asset.atomic_scale);
    v_prize_atomic := v_prize * power(10::numeric, v_asset.atomic_scale);

    IF v_fee <> 0 THEN
      INSERT INTO dna.economic_transaction (
        id, owner_id, natural_key, source_type, import_batch_id,
        race_entry_id, asset_currency_id, occurred_at, amount_atomic,
        direction, category, subcategory, operating_effect,
        classification_status, duplicate_status, external_reference,
        notes, created_at, updated_at
      )
      VALUES (
        md5(
          v_owner_id::text || ':race_economics:'
          || v_fact.race_entry_id::text || ':entry_fee'
        )::uuid,
        v_owner_id,
        'race:' || v_fact.source_event_id || ':core:'
          || v_fact.source_core_id || ':entry_fee',
        'race_derived', p_import_batch_id, v_fact.race_entry_id,
        v_asset.id, v_fact.event_at, -v_fee_atomic, 'debit',
        'unclassified', 'race_entry_fee', true, 'source_confirmed',
        'clear', v_fact.source_event_id, 'materialized by migration 0009',
        p_materialized_at, p_materialized_at
      )
      ON CONFLICT (owner_id, natural_key) DO NOTHING;
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_inserted := v_inserted + v_row_count;
    END IF;

    IF v_prize <> 0 THEN
      INSERT INTO dna.economic_transaction (
        id, owner_id, natural_key, source_type, import_batch_id,
        race_entry_id, asset_currency_id, occurred_at, amount_atomic,
        direction, category, subcategory, operating_effect,
        classification_status, duplicate_status, external_reference,
        notes, created_at, updated_at
      )
      VALUES (
        md5(
          v_owner_id::text || ':race_economics:'
          || v_fact.race_entry_id::text || ':prize'
        )::uuid,
        v_owner_id,
        'race:' || v_fact.source_event_id || ':core:'
          || v_fact.source_core_id || ':prize',
        'race_derived', p_import_batch_id, v_fact.race_entry_id,
        v_asset.id, v_fact.event_at, v_prize_atomic, 'credit',
        'unclassified', 'race_prize', true, 'source_confirmed',
        'clear', v_fact.source_event_id, 'materialized by migration 0009',
        p_materialized_at, p_materialized_at
      )
      ON CONFLICT (owner_id, natural_key) DO NOTHING;
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_inserted := v_inserted + v_row_count;
    END IF;

    UPDATE dna.race_entry
    SET economic_data_status = 'validated', updated_at = p_materialized_at
    WHERE owner_id = v_owner_id AND id = v_fact.race_entry_id;

    v_validated := v_validated + 1;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_validated, v_invalid;
END
$function$;

CREATE FUNCTION dna.refresh_race_usd_valuations(
  p_import_batch_id uuid,
  p_valued_at timestamptz
)
RETURNS TABLE (
  valued_transaction_count bigint,
  unavailable_transaction_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_valued bigint;
  v_unavailable bigint;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for race USD valuation';
  END IF;

  INSERT INTO dna.economic_transaction_usd_valuation (
    id, owner_id, economic_transaction_id, daily_usd_rate_id,
    signed_asset_amount, converted_usd_amount,
    valuation_status, valued_at
  )
  SELECT
    md5(
      transaction.owner_id::text || ':race_usd_valuation:'
      || transaction.id::text
    )::uuid,
    transaction.owner_id,
    transaction.id,
    rate.id,
    transaction.amount_atomic / power(10::numeric, asset.atomic_scale),
    (
      transaction.amount_atomic / power(10::numeric, asset.atomic_scale)
    ) * rate.usd_per_asset,
    rate.status,
    p_valued_at
  FROM dna.economic_transaction transaction
  JOIN dna.asset_currency asset
    ON asset.owner_id = transaction.owner_id
    AND asset.id = transaction.asset_currency_id
  JOIN dna.asset_daily_usd_rate rate
    ON rate.owner_id = transaction.owner_id
    AND rate.asset_currency_id = transaction.asset_currency_id
    AND rate.rate_date = (transaction.occurred_at AT TIME ZONE 'UTC')::date
  WHERE
    transaction.owner_id = v_owner_id
    AND transaction.import_batch_id = p_import_batch_id
    AND transaction.source_type = 'race_derived'
    AND transaction.subcategory IN ('race_entry_fee', 'race_prize')
    AND transaction.amount_atomic <> 0
  ON CONFLICT (owner_id, economic_transaction_id) DO NOTHING;

  GET DIAGNOSTICS v_valued = ROW_COUNT;

  SELECT count(*)
  INTO v_unavailable
  FROM dna.economic_transaction transaction
  LEFT JOIN dna.economic_transaction_usd_valuation valuation
    ON valuation.owner_id = transaction.owner_id
    AND valuation.economic_transaction_id = transaction.id
  WHERE
    transaction.owner_id = v_owner_id
    AND transaction.import_batch_id = p_import_batch_id
    AND transaction.source_type = 'race_derived'
    AND transaction.subcategory IN ('race_entry_fee', 'race_prize')
    AND valuation.id IS NULL;

  RETURN QUERY SELECT v_valued, v_unavailable;
END
$function$;

REVOKE ALL ON TABLE dna.asset_daily_usd_rate FROM PUBLIC;
REVOKE ALL ON TABLE dna.economic_transaction_usd_valuation FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_daily_usd_rate(
  text, date, text, text, text, timestamptz, timestamptz, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.materialize_race_economics(
  uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_race_usd_valuations(
  uuid, timestamptz
) FROM PUBLIC;

COMMIT;

BEGIN;

ALTER TABLE dna.normalized_race_staged_fact
  DROP CONSTRAINT normalized_race_staged_fact_economic_data_status_check;

ALTER TABLE dna.normalized_race_staged_fact
  ADD COLUMN race_asset text CHECK (
    race_asset IS NULL OR race_asset IN ('ETH', 'DEZ')
  ),
  ADD COLUMN entry_fee_amount numeric CHECK (
    entry_fee_amount IS NULL OR entry_fee_amount >= 0
  ),
  ADD COLUMN gross_payout_amount numeric CHECK (
    gross_payout_amount IS NULL OR gross_payout_amount >= 0
  ),
  ADD COLUMN payout_mechanism_source_value text,
  ADD COLUMN race_tags_source_value text,
  ADD CONSTRAINT normalized_race_staged_fact_economic_data_status_check
    CHECK (
      economic_data_status IN (
        'unvalidated',
        'ready',
        'missing',
        'invalid',
        'unsupported_asset'
      )
    ),
  ADD CONSTRAINT normalized_race_staged_fact_economics_ready_check
    CHECK (
      economic_data_status <> 'ready'
      OR (
        race_asset IS NOT NULL
        AND entry_fee_amount IS NOT NULL
        AND gross_payout_amount IS NOT NULL
      )
    );

ALTER TABLE dna.race_entry_source
  ADD COLUMN raw_race_tags text;

ALTER TABLE dna.race_event
  ADD COLUMN payout_mechanism_source_value text,
  ADD COLUMN race_tags_source_value text;

CREATE TABLE dna.daily_usd_rate (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  asset_currency_id uuid NOT NULL,
  rate_date date NOT NULL,
  usd_per_asset numeric NOT NULL CHECK (usd_per_asset > 0),
  provider text NOT NULL CHECK (provider IN ('coingecko', 'manual')),
  series_id text NOT NULL CHECK (btrim(series_id) <> ''),
  source_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  status text NOT NULL CHECK (
    status IN ('available', 'manual_override')
  ),
  supersedes_rate_id uuid,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (
    owner_id,
    asset_currency_id,
    rate_date,
    provider,
    series_id,
    source_at,
    usd_per_asset,
    status
  ),
  FOREIGN KEY (owner_id, asset_currency_id)
    REFERENCES dna.asset_currency(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, supersedes_rate_id)
    REFERENCES dna.daily_usd_rate(owner_id, id) ON DELETE RESTRICT,
  CHECK (retrieved_at >= source_at),
  CHECK (
    (provider = 'manual') = (status = 'manual_override')
  ),
  CHECK (supersedes_rate_id IS NULL OR supersedes_rate_id <> id)
);

CREATE UNIQUE INDEX daily_usd_rate_one_current
  ON dna.daily_usd_rate(owner_id, asset_currency_id, rate_date)
  WHERE is_current;

CREATE INDEX daily_usd_rate_history
  ON dna.daily_usd_rate(
    owner_id,
    asset_currency_id,
    rate_date,
    retrieved_at DESC
  );

CREATE TABLE dna.race_economic_contribution (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  economic_transaction_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  race_entry_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  transaction_type text NOT NULL CHECK (
    transaction_type IN ('entry_fee', 'payout')
  ),
  payout_mechanism_source_value text,
  race_tags_source_value text,
  is_selected boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (
    owner_id,
    economic_transaction_id,
    import_batch_id
  ),
  FOREIGN KEY (owner_id, economic_transaction_id)
    REFERENCES dna.economic_transaction(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, race_entry_id)
    REFERENCES dna.race_entry(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX race_economic_contribution_batch
  ON dna.race_economic_contribution(
    owner_id,
    import_batch_id,
    is_selected
  );

CREATE TABLE dna.economic_transaction_usd_valuation (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  economic_transaction_id uuid NOT NULL,
  daily_usd_rate_id uuid NOT NULL,
  converted_usd_amount numeric NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  valued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (
    owner_id,
    economic_transaction_id,
    daily_usd_rate_id
  ),
  FOREIGN KEY (owner_id, economic_transaction_id)
    REFERENCES dna.economic_transaction(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, daily_usd_rate_id)
    REFERENCES dna.daily_usd_rate(owner_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX economic_transaction_usd_one_current
  ON dna.economic_transaction_usd_valuation(
    owner_id,
    economic_transaction_id
  )
  WHERE is_current;

CREATE VIEW dna.current_race_economic_usd
WITH (security_invoker = true)
AS
SELECT
  transaction.id AS economic_transaction_id,
  transaction.owner_id,
  transaction.natural_key,
  transaction.race_entry_id,
  transaction.asset_currency_id,
  transaction.occurred_at,
  transaction.amount_atomic,
  transaction.direction,
  contribution.transaction_type,
  contribution.payout_mechanism_source_value,
  contribution.race_tags_source_value,
  rate.rate_date,
  rate.usd_per_asset,
  rate.provider AS rate_provider,
  rate.series_id AS rate_series_id,
  rate.status AS rate_status,
  valuation.converted_usd_amount,
  valuation.valued_at
FROM dna.economic_transaction transaction
JOIN dna.race_economic_contribution contribution
  ON contribution.owner_id = transaction.owner_id
  AND contribution.economic_transaction_id = transaction.id
  AND contribution.is_selected
LEFT JOIN dna.economic_transaction_usd_valuation valuation
  ON valuation.owner_id = transaction.owner_id
  AND valuation.economic_transaction_id = transaction.id
  AND valuation.is_current
LEFT JOIN dna.daily_usd_rate rate
  ON rate.owner_id = valuation.owner_id
  AND rate.id = valuation.daily_usd_rate_id
WHERE
  transaction.source_type = 'race_derived'
  AND transaction.duplicate_status <> 'excluded';

CREATE VIEW dna.race_economic_usd_coverage
WITH (security_invoker = true)
AS
SELECT
  transaction.owner_id,
  count(*) AS transaction_count,
  count(valuation.id) AS valued_transaction_count,
  count(*) - count(valuation.id) AS missing_rate_transaction_count,
  bool_and(valuation.id IS NOT NULL) AS is_complete
FROM dna.economic_transaction transaction
LEFT JOIN dna.economic_transaction_usd_valuation valuation
  ON valuation.owner_id = transaction.owner_id
  AND valuation.economic_transaction_id = transaction.id
  AND valuation.is_current
WHERE
  transaction.source_type = 'race_derived'
  AND transaction.duplicate_status <> 'excluded'
GROUP BY transaction.owner_id;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'daily_usd_rate',
    'race_economic_contribution',
    'economic_transaction_usd_valuation'
  ]
  LOOP
    EXECUTE format('ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())',
      table_name
    );
  END LOOP;
END
$policies$;

CREATE FUNCTION dna.exact_decimal_to_atomic(
  p_amount numeric,
  p_atomic_scale smallint
)
RETURNS numeric(78, 0)
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $function$
DECLARE
  v_scaled numeric;
BEGIN
  IF p_atomic_scale < 0 OR p_atomic_scale > 30 THEN
    RAISE EXCEPTION 'atomic scale must be between 0 and 30';
  END IF;

  v_scaled := p_amount * power(10::numeric, p_atomic_scale);
  IF v_scaled <> trunc(v_scaled) THEN
    RAISE EXCEPTION 'amount has more decimal places than the asset scale';
  END IF;
  IF abs(v_scaled) >= power(10::numeric, 78) THEN
    RAISE EXCEPTION 'atomic amount exceeds numeric(78,0)';
  END IF;

  RETURN v_scaled::numeric(78, 0);
END
$function$;

CREATE FUNCTION dna.race_economic_natural_key(
  p_source_event_id text,
  p_source_core_id text,
  p_transaction_type text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $function$
DECLARE
  v_entry_key text;
BEGIN
  IF btrim(p_source_event_id) = '' OR btrim(p_source_core_id) = '' THEN
    RAISE EXCEPTION 'race economic identity parts must not be blank';
  END IF;
  IF p_transaction_type NOT IN ('entry_fee', 'payout') THEN
    RAISE EXCEPTION 'unsupported race economic transaction type';
  END IF;

  v_entry_key := format(
    'race_entry|%s:%s|%s:%s',
    length(btrim(p_source_event_id)),
    btrim(p_source_event_id),
    length(btrim(p_source_core_id)),
    btrim(p_source_core_id)
  );

  RETURN format(
    'race_economic|%s:%s|%s:%s',
    length(v_entry_key),
    v_entry_key,
    length(p_transaction_type),
    p_transaction_type
  );
END
$function$;

CREATE FUNCTION dna.materialize_owned_race_economics(
  p_import_batch_id uuid,
  p_materialized_at timestamptz
)
RETURNS TABLE (
  materialized_transaction_count bigint,
  review_required_entry_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_batch dna.import_batch%ROWTYPE;
  v_materialized_count bigint;
  v_review_count bigint;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for race economics';
  END IF;

  SELECT *
  INTO v_batch
  FROM dna.import_batch
  WHERE owner_id = v_owner_id AND id = p_import_batch_id
  FOR UPDATE;

  IF v_batch.id IS NULL OR v_batch.source_type <> 'race_merge' THEN
    RAISE EXCEPTION 'owner-scoped Race Merge import batch does not exist';
  END IF;
  IF v_batch.status <> 'accepted' THEN
    RAISE EXCEPTION 'Race Merge batch must be accepted before economics';
  END IF;

  WITH consistent_event AS (
    SELECT
      fact.source_event_id,
      min(NULLIF(btrim(fact.payout_mechanism_source_value), ''))
        AS payout_mechanism_source_value,
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
      count(DISTINCT NULLIF(
        btrim(fact.payout_mechanism_source_value),
        ''
      )) <= 1
      AND count(DISTINCT NULLIF(
        btrim(fact.race_tags_source_value),
        ''
      )) <= 1
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

  UPDATE dna.race_entry entry
  SET
    economic_data_status = CASE fact.economic_data_status
      WHEN 'ready' THEN 'validated'
      WHEN 'invalid' THEN 'invalid'
      WHEN 'unsupported_asset' THEN 'invalid'
      WHEN 'missing' THEN 'unvalidated'
      ELSE 'unvalidated'
    END,
    updated_at = p_materialized_at
  FROM dna.race_entry_source source
  JOIN dna.normalized_race_staged_fact fact
    ON fact.owner_id = source.owner_id
    AND fact.import_batch_id = source.import_batch_id
    AND fact.source_row_number = source.source_row_number
  WHERE
    entry.owner_id = v_owner_id
    AND source.owner_id = entry.owner_id
    AND source.race_entry_id = entry.id
    AND source.import_batch_id = p_import_batch_id
    AND source.is_selected_fact;

  IF EXISTS (
    SELECT 1
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.race_entry_source source
      ON source.owner_id = fact.owner_id
      AND source.import_batch_id = fact.import_batch_id
      AND source.source_row_number = fact.source_row_number
      AND source.is_selected_fact
    JOIN dna.race_entry entry
      ON entry.owner_id = source.owner_id
      AND entry.id = source.race_entry_id
    JOIN dna.current_vault_snapshot_entry vault
      ON vault.owner_id = entry.owner_id
      AND vault.proposed_core_id = entry.core_id
    JOIN dna.identity_review review
      ON review.owner_id = vault.owner_id
      AND review.id = vault.identity_review_id
      AND review.match_status = 'confirmed'
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND fact.economic_data_status = 'ready'
      AND NOT EXISTS (
        SELECT 1
        FROM dna.asset_currency asset
        WHERE
          asset.owner_id = v_owner_id
          AND upper(asset.code) = fact.race_asset
          AND (
            (fact.race_asset = 'ETH' AND asset.asset_kind = 'crypto')
            OR (fact.race_asset = 'DEZ' AND asset.asset_kind = 'game_token')
          )
      )
  ) THEN
    RAISE EXCEPTION 'authoritative ETH/DEZ asset scale must be provisioned';
  END IF;

  INSERT INTO dna.reconciliation_issue (
    id,
    owner_id,
    issue_type,
    entity_type,
    entity_id,
    status,
    reason_code,
    created_at,
    updated_at
  )
  SELECT DISTINCT ON (entry.id)
    md5(
      v_owner_id::text
      || ':race_economics_review:'
      || entry.id::text
    )::uuid,
    v_owner_id,
    'economic_classification',
    'race_entry',
    entry.id,
    'open',
    'RACE_ECONOMICS_' || upper(fact.economic_data_status),
    p_materialized_at,
    p_materialized_at
  FROM dna.normalized_race_staged_fact fact
  JOIN dna.race_entry_source source
    ON source.owner_id = fact.owner_id
    AND source.import_batch_id = fact.import_batch_id
    AND source.source_row_number = fact.source_row_number
    AND source.is_selected_fact
  JOIN dna.race_entry entry
    ON entry.owner_id = source.owner_id
    AND entry.id = source.race_entry_id
  JOIN dna.current_vault_snapshot_entry vault
    ON vault.owner_id = entry.owner_id
    AND vault.proposed_core_id = entry.core_id
  JOIN dna.identity_review review
    ON review.owner_id = vault.owner_id
    AND review.id = vault.identity_review_id
    AND review.match_status = 'confirmed'
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND fact.economic_data_status <> 'ready'
  ORDER BY entry.id, fact.source_row_number
  ON CONFLICT (owner_id, id) DO NOTHING;

  WITH candidates AS (
    SELECT
      entry.id AS race_entry_id,
      event.source_event_id,
      entry.source_core_id,
      event.event_at,
      fact.source_row_number,
      fact.payout_mechanism_source_value,
      fact.race_tags_source_value,
      asset.id AS asset_currency_id,
      asset.atomic_scale,
      economic.transaction_type,
      economic.amount,
      dna.race_economic_natural_key(
        event.source_event_id,
        entry.source_core_id,
        economic.transaction_type
      ) AS natural_key
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.race_entry_source source
      ON source.owner_id = fact.owner_id
      AND source.import_batch_id = fact.import_batch_id
      AND source.source_row_number = fact.source_row_number
      AND source.is_selected_fact
    JOIN dna.race_entry entry
      ON entry.owner_id = source.owner_id
      AND entry.id = source.race_entry_id
    JOIN dna.race_event event
      ON event.owner_id = entry.owner_id
      AND event.id = entry.race_event_id
      AND event.active_in_dataset
    JOIN dna.current_vault_snapshot_entry vault
      ON vault.owner_id = entry.owner_id
      AND vault.proposed_core_id = entry.core_id
    JOIN dna.identity_review review
      ON review.owner_id = vault.owner_id
      AND review.id = vault.identity_review_id
      AND review.match_status = 'confirmed'
    JOIN dna.asset_currency asset
      ON asset.owner_id = fact.owner_id
      AND upper(asset.code) = fact.race_asset
      AND (
        (fact.race_asset = 'ETH' AND asset.asset_kind = 'crypto')
        OR (fact.race_asset = 'DEZ' AND asset.asset_kind = 'game_token')
      )
    CROSS JOIN LATERAL (
      VALUES
        ('entry_fee'::text, fact.entry_fee_amount),
        ('payout'::text, fact.gross_payout_amount)
    ) economic(transaction_type, amount)
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND fact.economic_data_status = 'ready'
      AND economic.amount > 0
  )
  INSERT INTO dna.economic_transaction (
    id,
    owner_id,
    natural_key,
    source_type,
    import_batch_id,
    race_entry_id,
    asset_currency_id,
    occurred_at,
    amount_atomic,
    direction,
    category,
    subcategory,
    operating_effect,
    classification_status,
    duplicate_status,
    external_reference,
    created_at,
    updated_at
  )
  SELECT
    md5(v_owner_id::text || ':economic_transaction:' || candidate.natural_key)::uuid,
    v_owner_id,
    candidate.natural_key,
    'race_derived',
    p_import_batch_id,
    candidate.race_entry_id,
    candidate.asset_currency_id,
    candidate.event_at,
    dna.exact_decimal_to_atomic(
      CASE
        WHEN candidate.transaction_type = 'entry_fee'
          THEN -candidate.amount
        ELSE candidate.amount
      END,
      candidate.atomic_scale
    ),
    CASE
      WHEN candidate.transaction_type = 'entry_fee' THEN 'debit'
      ELSE 'credit'
    END,
    'unclassified',
    candidate.transaction_type,
    true,
    'review_required',
    'clear',
    candidate.source_event_id,
    p_materialized_at,
    p_materialized_at
  FROM candidates candidate
  ON CONFLICT (owner_id, natural_key) DO NOTHING;

  WITH candidates AS (
    SELECT
      entry.id AS race_entry_id,
      event.source_event_id,
      entry.source_core_id,
      event.event_at,
      asset.id AS asset_currency_id,
      asset.atomic_scale,
      economic.transaction_type,
      economic.amount,
      dna.race_economic_natural_key(
        event.source_event_id,
        entry.source_core_id,
        economic.transaction_type
      ) AS natural_key
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.race_entry_source source
      ON source.owner_id = fact.owner_id
      AND source.import_batch_id = fact.import_batch_id
      AND source.source_row_number = fact.source_row_number
      AND source.is_selected_fact
    JOIN dna.race_entry entry
      ON entry.owner_id = source.owner_id
      AND entry.id = source.race_entry_id
    JOIN dna.race_event event
      ON event.owner_id = entry.owner_id
      AND event.id = entry.race_event_id
      AND event.active_in_dataset
    JOIN dna.current_vault_snapshot_entry vault
      ON vault.owner_id = entry.owner_id
      AND vault.proposed_core_id = entry.core_id
    JOIN dna.identity_review review
      ON review.owner_id = vault.owner_id
      AND review.id = vault.identity_review_id
      AND review.match_status = 'confirmed'
    JOIN dna.asset_currency asset
      ON asset.owner_id = fact.owner_id
      AND upper(asset.code) = fact.race_asset
    CROSS JOIN LATERAL (
      VALUES
        ('entry_fee'::text, fact.entry_fee_amount),
        ('payout'::text, fact.gross_payout_amount)
    ) economic(transaction_type, amount)
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND fact.economic_data_status = 'ready'
      AND economic.amount > 0
  )
  SELECT count(*)
  INTO v_materialized_count
  FROM candidates candidate
  JOIN dna.economic_transaction transaction
    ON transaction.owner_id = v_owner_id
    AND transaction.natural_key = candidate.natural_key
  WHERE
    transaction.source_type <> 'race_derived'
    OR transaction.race_entry_id <> candidate.race_entry_id
    OR transaction.asset_currency_id <> candidate.asset_currency_id
    OR transaction.occurred_at <> candidate.event_at
    OR transaction.amount_atomic <> dna.exact_decimal_to_atomic(
      CASE
        WHEN candidate.transaction_type = 'entry_fee'
          THEN -candidate.amount
        ELSE candidate.amount
      END,
      candidate.atomic_scale
    )
    OR transaction.direction <> CASE
      WHEN candidate.transaction_type = 'entry_fee' THEN 'debit'
      ELSE 'credit'
    END;

  IF v_materialized_count > 0 THEN
    RAISE EXCEPTION 'race economic natural key conflicts with accepted value';
  END IF;

  WITH candidates AS (
    SELECT
      entry.id AS race_entry_id,
      event.source_event_id,
      entry.source_core_id,
      fact.source_row_number,
      fact.payout_mechanism_source_value,
      fact.race_tags_source_value,
      economic.transaction_type,
      dna.race_economic_natural_key(
        event.source_event_id,
        entry.source_core_id,
        economic.transaction_type
      ) AS natural_key
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.race_entry_source source
      ON source.owner_id = fact.owner_id
      AND source.import_batch_id = fact.import_batch_id
      AND source.source_row_number = fact.source_row_number
      AND source.is_selected_fact
    JOIN dna.race_entry entry
      ON entry.owner_id = source.owner_id
      AND entry.id = source.race_entry_id
    JOIN dna.race_event event
      ON event.owner_id = entry.owner_id
      AND event.id = entry.race_event_id
      AND event.active_in_dataset
    JOIN dna.current_vault_snapshot_entry vault
      ON vault.owner_id = entry.owner_id
      AND vault.proposed_core_id = entry.core_id
    JOIN dna.identity_review review
      ON review.owner_id = vault.owner_id
      AND review.id = vault.identity_review_id
      AND review.match_status = 'confirmed'
    CROSS JOIN LATERAL (
      VALUES
        ('entry_fee'::text, fact.entry_fee_amount),
        ('payout'::text, fact.gross_payout_amount)
    ) economic(transaction_type, amount)
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND fact.economic_data_status = 'ready'
      AND economic.amount > 0
  )
  INSERT INTO dna.race_economic_contribution (
    id,
    owner_id,
    economic_transaction_id,
    import_batch_id,
    race_entry_id,
    source_row_number,
    transaction_type,
    payout_mechanism_source_value,
    race_tags_source_value,
    is_selected,
    created_at
  )
  SELECT
    md5(
      v_owner_id::text
      || ':race_economic_contribution:'
      || transaction.id::text
      || ':'
      || p_import_batch_id::text
    )::uuid,
    v_owner_id,
    transaction.id,
    p_import_batch_id,
    candidate.race_entry_id,
    candidate.source_row_number,
    candidate.transaction_type,
    candidate.payout_mechanism_source_value,
    candidate.race_tags_source_value,
    true,
    p_materialized_at
  FROM candidates candidate
  JOIN dna.economic_transaction transaction
    ON transaction.owner_id = v_owner_id
    AND transaction.natural_key = candidate.natural_key
  ON CONFLICT (
    owner_id,
    economic_transaction_id,
    import_batch_id
  ) DO UPDATE
  SET
    is_selected = true,
    payout_mechanism_source_value =
      EXCLUDED.payout_mechanism_source_value,
    race_tags_source_value = EXCLUDED.race_tags_source_value;

  UPDATE dna.economic_transaction transaction
  SET
    duplicate_status = 'clear',
    updated_at = p_materialized_at
  WHERE
    transaction.owner_id = v_owner_id
    AND transaction.source_type = 'race_derived'
    AND EXISTS (
      SELECT 1
      FROM dna.race_economic_contribution contribution
      WHERE
        contribution.owner_id = transaction.owner_id
        AND contribution.economic_transaction_id = transaction.id
        AND contribution.is_selected
    );

  SELECT count(DISTINCT contribution.economic_transaction_id)
  INTO v_materialized_count
  FROM dna.race_economic_contribution contribution
  WHERE
    contribution.owner_id = v_owner_id
    AND contribution.import_batch_id = p_import_batch_id
    AND contribution.is_selected;

  SELECT count(DISTINCT issue.entity_id)
  INTO v_review_count
  FROM dna.reconciliation_issue issue
  WHERE
    issue.owner_id = v_owner_id
    AND issue.entity_type = 'race_entry'
    AND issue.status = 'open'
    AND issue.reason_code LIKE 'RACE_ECONOMICS_%';

  RETURN QUERY SELECT v_materialized_count, v_review_count;
END
$function$;

CREATE FUNCTION dna.record_daily_usd_rate(
  p_asset_code text,
  p_rate_date date,
  p_usd_per_asset numeric,
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
  v_expected_series text;
  v_existing_id uuid;
  v_supersedes_rate_id uuid;
  v_rate_id uuid;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for daily rates';
  END IF;
  IF p_usd_per_asset <= 0 THEN
    RAISE EXCEPTION 'USD rate must be greater than zero';
  END IF;
  IF p_retrieved_at < p_source_at THEN
    RAISE EXCEPTION 'rate retrieval cannot precede source time';
  END IF;
  IF p_provider NOT IN ('coingecko', 'manual') THEN
    RAISE EXCEPTION 'unsupported daily-rate provider';
  END IF;
  IF (p_provider = 'manual') <> (p_status = 'manual_override') THEN
    RAISE EXCEPTION 'manual provider and override status must agree';
  END IF;
  IF p_status NOT IN ('available', 'manual_override') THEN
    RAISE EXCEPTION 'unsupported daily-rate status';
  END IF;

  SELECT *
  INTO v_asset
  FROM dna.asset_currency
  WHERE
    owner_id = v_owner_id
    AND upper(code) = upper(btrim(p_asset_code))
  FOR UPDATE;

  IF v_asset.id IS NULL OR upper(v_asset.code) NOT IN ('ETH', 'DEZ') THEN
    RAISE EXCEPTION 'owner-scoped ETH/DEZ asset does not exist';
  END IF;

  IF p_provider = 'coingecko' THEN
    v_expected_series := CASE upper(v_asset.code)
      WHEN 'ETH' THEN 'coingecko:coin:ethereum'
      WHEN 'DEZ' THEN
        'coingecko:polygon-pos:contract:0xdc4f4ed9872571d5ec8986a502a0d88f3a175f1e'
    END;
    IF p_series_id <> v_expected_series THEN
      RAISE EXCEPTION 'CoinGecko series does not match the asset';
    END IF;
  ELSIF NULLIF(btrim(p_series_id), '') IS NULL THEN
    RAISE EXCEPTION 'manual rate series must not be blank';
  END IF;

  SELECT id
  INTO v_existing_id
  FROM dna.daily_usd_rate
  WHERE
    owner_id = v_owner_id
    AND asset_currency_id = v_asset.id
    AND rate_date = p_rate_date
    AND provider = p_provider
    AND series_id = p_series_id
    AND source_at = p_source_at
    AND usd_per_asset = p_usd_per_asset
    AND status = p_status;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  SELECT id
  INTO v_supersedes_rate_id
  FROM dna.daily_usd_rate
  WHERE
    owner_id = v_owner_id
    AND asset_currency_id = v_asset.id
    AND rate_date = p_rate_date
    AND is_current
  FOR UPDATE;

  v_rate_id := md5(
    v_owner_id::text
    || ':daily_usd_rate:'
    || v_asset.id::text
    || ':'
    || p_rate_date::text
    || ':'
    || p_provider
    || ':'
    || p_series_id
    || ':'
    || p_source_at::text
    || ':'
    || p_usd_per_asset::text
    || ':'
    || p_status
  )::uuid;

  UPDATE dna.daily_usd_rate
  SET is_current = false
  WHERE
    owner_id = v_owner_id
    AND asset_currency_id = v_asset.id
    AND rate_date = p_rate_date
    AND is_current;

  INSERT INTO dna.daily_usd_rate (
    id,
    owner_id,
    asset_currency_id,
    rate_date,
    usd_per_asset,
    provider,
    series_id,
    source_at,
    retrieved_at,
    status,
    supersedes_rate_id,
    is_current,
    created_at
  )
  VALUES (
    v_rate_id,
    v_owner_id,
    v_asset.id,
    p_rate_date,
    p_usd_per_asset,
    p_provider,
    p_series_id,
    p_source_at,
    p_retrieved_at,
    p_status,
    v_supersedes_rate_id,
    true,
    p_retrieved_at
  );

  RETURN v_rate_id;
END
$function$;

CREATE FUNCTION dna.refresh_race_usd_valuations(
  p_valued_at timestamptz
)
RETURNS TABLE (
  valued_transaction_count bigint,
  missing_rate_transaction_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_valued_count bigint;
  v_missing_count bigint;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for USD valuation';
  END IF;

  UPDATE dna.economic_transaction_usd_valuation valuation
  SET is_current = false
  WHERE
    valuation.owner_id = v_owner_id
    AND valuation.is_current
    AND EXISTS (
      SELECT 1
      FROM dna.economic_transaction transaction
      JOIN dna.daily_usd_rate rate
        ON rate.owner_id = transaction.owner_id
        AND rate.asset_currency_id = transaction.asset_currency_id
        AND rate.rate_date = transaction.occurred_at::date
        AND rate.is_current
      WHERE
        transaction.owner_id = valuation.owner_id
        AND transaction.id = valuation.economic_transaction_id
        AND transaction.source_type = 'race_derived'
        AND transaction.duplicate_status <> 'excluded'
        AND valuation.daily_usd_rate_id <> rate.id
    );

  INSERT INTO dna.economic_transaction_usd_valuation (
    id,
    owner_id,
    economic_transaction_id,
    daily_usd_rate_id,
    converted_usd_amount,
    is_current,
    valued_at,
    created_at
  )
  SELECT
    md5(
      v_owner_id::text
      || ':economic_transaction_usd:'
      || transaction.id::text
      || ':'
      || rate.id::text
    )::uuid,
    v_owner_id,
    transaction.id,
    rate.id,
    (
      transaction.amount_atomic
      / power(10::numeric, asset.atomic_scale)
    ) * rate.usd_per_asset,
    true,
    p_valued_at,
    p_valued_at
  FROM dna.economic_transaction transaction
  JOIN dna.asset_currency asset
    ON asset.owner_id = transaction.owner_id
    AND asset.id = transaction.asset_currency_id
  JOIN dna.daily_usd_rate rate
    ON rate.owner_id = transaction.owner_id
    AND rate.asset_currency_id = transaction.asset_currency_id
    AND rate.rate_date = transaction.occurred_at::date
    AND rate.is_current
  WHERE
    transaction.owner_id = v_owner_id
    AND transaction.source_type = 'race_derived'
    AND transaction.duplicate_status <> 'excluded'
  ON CONFLICT (
    owner_id,
    economic_transaction_id,
    daily_usd_rate_id
  ) DO UPDATE
  SET
    converted_usd_amount = EXCLUDED.converted_usd_amount,
    is_current = true,
    valued_at = EXCLUDED.valued_at;

  SELECT
    count(valuation.id),
    count(*) - count(valuation.id)
  INTO v_valued_count, v_missing_count
  FROM dna.economic_transaction transaction
  LEFT JOIN dna.economic_transaction_usd_valuation valuation
    ON valuation.owner_id = transaction.owner_id
    AND valuation.economic_transaction_id = transaction.id
    AND valuation.is_current
  WHERE
    transaction.owner_id = v_owner_id
    AND transaction.source_type = 'race_derived'
    AND transaction.duplicate_status <> 'excluded';

  RETURN QUERY SELECT v_valued_count, v_missing_count;
END
$function$;

ALTER FUNCTION dna.rollback_active_dataset(text, text, timestamptz)
  RENAME TO rollback_active_dataset_pre_economics;

CREATE FUNCTION dna.rollback_active_dataset(
  p_source_type text,
  p_reason text,
  p_rolled_back_at timestamptz
)
RETURNS TABLE (
  rolled_back_version_number bigint,
  restored_version_number bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_rolled_back_version bigint;
  v_restored_version bigint;
  v_rolled_back_batch_id uuid;
BEGIN
  SELECT rollback.rolled_back_version_number, rollback.restored_version_number
  INTO v_rolled_back_version, v_restored_version
  FROM dna.rollback_active_dataset_pre_economics(
    p_source_type,
    p_reason,
    p_rolled_back_at
  ) rollback;

  IF p_source_type = 'race_merge' THEN
    SELECT import_batch_id
    INTO v_rolled_back_batch_id
    FROM dna.dataset_version
    WHERE
      owner_id = v_owner_id
      AND source_type = 'race_merge'
      AND version_number = v_rolled_back_version;

    UPDATE dna.race_economic_contribution
    SET is_selected = false
    WHERE
      owner_id = v_owner_id
      AND import_batch_id = v_rolled_back_batch_id;

    UPDATE dna.economic_transaction transaction
    SET
      duplicate_status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM dna.race_economic_contribution contribution
          JOIN dna.import_batch batch
            ON batch.owner_id = contribution.owner_id
            AND batch.id = contribution.import_batch_id
          WHERE
            contribution.owner_id = transaction.owner_id
            AND contribution.economic_transaction_id = transaction.id
            AND contribution.is_selected
            AND batch.status <> 'rolled_back'
        ) THEN 'clear'
        ELSE 'excluded'
      END,
      updated_at = p_rolled_back_at
    WHERE
      transaction.owner_id = v_owner_id
      AND transaction.source_type = 'race_derived';
  END IF;

  RETURN QUERY SELECT v_rolled_back_version, v_restored_version;
END
$function$;

REVOKE ALL ON TABLE dna.daily_usd_rate FROM PUBLIC;
REVOKE ALL ON TABLE dna.race_economic_contribution FROM PUBLIC;
REVOKE ALL ON TABLE dna.economic_transaction_usd_valuation FROM PUBLIC;
REVOKE ALL ON TABLE dna.current_race_economic_usd FROM PUBLIC;
REVOKE ALL ON TABLE dna.race_economic_usd_coverage FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.exact_decimal_to_atomic(numeric, smallint)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.race_economic_natural_key(text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.materialize_owned_race_economics(uuid, timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_daily_usd_rate(
  text,
  date,
  numeric,
  text,
  text,
  timestamptz,
  timestamptz,
  text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_race_usd_valuations(timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset_pre_economics(
  text,
  text,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text,
  text,
  timestamptz
) FROM PUBLIC;

COMMIT;

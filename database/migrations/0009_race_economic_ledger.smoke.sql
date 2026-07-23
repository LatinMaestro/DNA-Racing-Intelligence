BEGIN;

SET LOCAL app.owner_id = '90000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '90000000-0000-4000-8000-000000000001',
  'synthetic_race_economics_owner'
);

INSERT INTO dna.asset_currency (
  id,
  owner_id,
  code,
  display_name,
  asset_kind,
  atomic_scale
)
VALUES
  (
    '90000000-0000-4000-8000-000000000011',
    '90000000-0000-4000-8000-000000000001',
    'ETH',
    'Ether',
    'crypto',
    18
  ),
  (
    '90000000-0000-4000-8000-000000000012',
    '90000000-0000-4000-8000-000000000001',
    'DEZ',
    'DNA Racing DEZ',
    'game_token',
    18
  );

INSERT INTO dna.import_batch (
  id,
  owner_id,
  source_type,
  source_filename,
  checksum_sha256,
  detected_encoding,
  schema_version,
  status,
  uploaded_at,
  import_completed_at,
  minimum_accepted_event_at,
  maximum_accepted_event_at,
  dataset_current_through_after_import,
  source_rows,
  accepted_rows,
  rejected_rows,
  warning_rows
)
VALUES
  (
    '90000000-0000-4000-8000-000000000101',
    '90000000-0000-4000-8000-000000000001',
    'core_details',
    'synthetic-core-details.csv',
    repeat('1', 64),
    'utf_8',
    'core-details/v1',
    'accepted',
    '2026-07-23T00:00:00Z',
    '2026-07-23T00:01:00Z',
    NULL,
    NULL,
    '2026-07-23T00:01:00Z',
    1,
    1,
    0,
    0
  ),
  (
    '90000000-0000-4000-8000-000000000102',
    '90000000-0000-4000-8000-000000000001',
    'current_vault',
    'synthetic-current-vault.csv',
    repeat('2', 64),
    'utf_8',
    'current-vault/v1',
    'accepted',
    '2026-07-23T00:02:00Z',
    '2026-07-23T00:03:00Z',
    NULL,
    NULL,
    '2026-07-23T00:02:00Z',
    1,
    1,
    0,
    0
  ),
  (
    '90000000-0000-4000-8000-000000000103',
    '90000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-prior-races.csv',
    repeat('3', 64),
    'utf_8',
    'race-merge/v1',
    'accepted',
    '2026-07-23T00:04:00Z',
    '2026-07-23T00:05:00Z',
    NULL,
    NULL,
    '2026-07-21T23:59:00Z',
    0,
    0,
    0,
    0
  ),
  (
    '90000000-0000-4000-8000-000000000104',
    '90000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-race-economics.csv',
    repeat('4', 64),
    'utf_8',
    'race-merge/v1',
    'accepted',
    '2026-07-23T00:06:00Z',
    '2026-07-23T00:07:00Z',
    '2026-07-22T12:00:00Z',
    '2026-07-22T13:00:00Z',
    '2026-07-22T13:00:00Z',
    2,
    2,
    0,
    0
  );

INSERT INTO dna.core (
  id,
  owner_id,
  source_core_id,
  display_name,
  core_class,
  element,
  f_number,
  sex,
  source_import_batch_id
)
VALUES (
  '90000000-0000-4000-8000-000000000201',
  '90000000-0000-4000-8000-000000000001',
  'synthetic-owned-core',
  'Synthetic Owned Core',
  'Morphed',
  'Water',
  2,
  'female',
  '90000000-0000-4000-8000-000000000101'
);

INSERT INTO dna.vault_snapshot (
  id,
  owner_id,
  import_batch_id,
  captured_at,
  imported_at,
  is_current
)
VALUES (
  '90000000-0000-4000-8000-000000000301',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000102',
  '2026-07-23T00:02:00Z',
  '2026-07-23T00:03:00Z',
  true
);

INSERT INTO dna.identity_review (
  id,
  owner_id,
  source_type,
  import_batch_id,
  raw_source_name,
  proposed_core_id,
  match_status,
  resolution_note,
  resolved_at
)
VALUES (
  '90000000-0000-4000-8000-000000000302',
  '90000000-0000-4000-8000-000000000001',
  'current_vault',
  '90000000-0000-4000-8000-000000000102',
  'Synthetic Owned Core',
  '90000000-0000-4000-8000-000000000201',
  'confirmed',
  'synthetic authoritative identity',
  '2026-07-23T00:03:00Z'
);

INSERT INTO dna.vault_snapshot_entry (
  id,
  owner_id,
  vault_snapshot_id,
  source_row_number,
  source_record_key,
  raw_source_name,
  core_class,
  element,
  f_number,
  sex,
  maiden_state,
  maiden_source_value,
  identity_review_id,
  proposed_core_id
)
VALUES (
  '90000000-0000-4000-8000-000000000303',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000301',
  1,
  'synthetic-vault-record',
  'Synthetic Owned Core',
  'Morphed',
  'Water',
  2,
  'female',
  'eligible',
  'TRUE',
  '90000000-0000-4000-8000-000000000302',
  '90000000-0000-4000-8000-000000000201'
);

INSERT INTO dna.dataset_stream (owner_id, source_type)
VALUES (
  '90000000-0000-4000-8000-000000000001',
  'race_merge'
);

INSERT INTO dna.dataset_version (
  id,
  owner_id,
  source_type,
  version_number,
  import_batch_id,
  activated_at,
  data_current_through,
  is_active
)
VALUES
  (
    '90000000-0000-4000-8000-000000000401',
    '90000000-0000-4000-8000-000000000001',
    'race_merge',
    1,
    '90000000-0000-4000-8000-000000000103',
    '2026-07-23T00:05:00Z',
    '2026-07-21T23:59:00Z',
    false
  ),
  (
    '90000000-0000-4000-8000-000000000402',
    '90000000-0000-4000-8000-000000000001',
    'race_merge',
    2,
    '90000000-0000-4000-8000-000000000104',
    '2026-07-23T00:07:00Z',
    '2026-07-22T13:00:00Z',
    true
  );

INSERT INTO dna.dataset_staged_record (
  owner_id,
  import_batch_id,
  source_row_number,
  natural_key,
  fingerprint_sha256,
  status,
  issue_codes
)
VALUES
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000104',
    1,
    'race-entry-dez',
    repeat('a', 64),
    'ready',
    '{}'
  ),
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000104',
    2,
    'race-entry-eth',
    repeat('b', 64),
    'ready',
    '{}'
  );

INSERT INTO dna.normalized_race_staged_fact (
  owner_id,
  import_batch_id,
  source_row_number,
  source_event_id,
  event_at,
  mode,
  distance,
  source_core_id,
  source_core_name,
  source_gate,
  gate_count,
  gold_star,
  blue_star,
  raw_gold_star,
  raw_blue_star,
  star_data_status,
  finish_position,
  elapsed_time_source_value,
  source_format_label,
  raw_entry_fee,
  raw_payout,
  raw_prize,
  raw_asset,
  economic_data_status,
  race_asset,
  entry_fee_amount,
  gross_payout_amount,
  payout_mechanism_source_value,
  race_tags_source_value
)
VALUES
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000104',
    1,
    'synthetic-dez-event',
    '2026-07-22T12:00:00Z',
    'bike',
    1200,
    'synthetic-owned-core',
    'Synthetic Owned Core',
    1,
    4,
    true,
    false,
    'TRUE',
    'FALSE',
    'complete',
    1,
    '60.125',
    'synthetic-format',
    '2417.2105',
    'top2',
    '7251.6315',
    'DEZ',
    'ready',
    'DEZ',
    2417.2105,
    7251.6315,
    'top2',
    'Water, ME'
  ),
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000104',
    2,
    'synthetic-eth-event',
    '2026-07-22T13:00:00Z',
    'car',
    1000,
    'synthetic-owned-core',
    'Synthetic Owned Core',
    1,
    4,
    false,
    true,
    'FALSE',
    'TRUE',
    'complete',
    2,
    '50.250',
    'synthetic-format',
    '0.01',
    'winner',
    '0',
    'ETH',
    'ready',
    'ETH',
    0.01,
    0,
    'winner',
    NULL
  );

INSERT INTO dna.race_event (
  id,
  owner_id,
  source_event_id,
  event_at,
  mode,
  distance,
  gate_count,
  source_format_label,
  source_import_batch_id,
  active_in_dataset
)
VALUES
  (
    '90000000-0000-4000-8000-000000000501',
    '90000000-0000-4000-8000-000000000001',
    'synthetic-dez-event',
    '2026-07-22T12:00:00Z',
    'bike',
    1200,
    4,
    'synthetic-format',
    '90000000-0000-4000-8000-000000000104',
    true
  ),
  (
    '90000000-0000-4000-8000-000000000502',
    '90000000-0000-4000-8000-000000000001',
    'synthetic-eth-event',
    '2026-07-22T13:00:00Z',
    'car',
    1000,
    4,
    'synthetic-format',
    '90000000-0000-4000-8000-000000000104',
    true
  );

INSERT INTO dna.race_entry (
  id,
  owner_id,
  race_event_id,
  source_core_id,
  core_id,
  gate_count,
  gold_star,
  blue_star,
  star_data_status,
  finish_position,
  economic_data_status,
  source_import_batch_id,
  active_in_dataset
)
VALUES
  (
    '90000000-0000-4000-8000-000000000601',
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000501',
    'synthetic-owned-core',
    '90000000-0000-4000-8000-000000000201',
    4,
    true,
    false,
    'complete',
    1,
    'unvalidated',
    '90000000-0000-4000-8000-000000000104',
    true
  ),
  (
    '90000000-0000-4000-8000-000000000602',
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000502',
    'synthetic-owned-core',
    '90000000-0000-4000-8000-000000000201',
    4,
    false,
    true,
    'complete',
    2,
    'unvalidated',
    '90000000-0000-4000-8000-000000000104',
    true
  );

INSERT INTO dna.race_entry_source (
  id,
  owner_id,
  race_entry_id,
  import_batch_id,
  source_row_number,
  source_row_checksum,
  raw_gold_star,
  raw_blue_star,
  raw_entry_fee,
  raw_payout,
  is_selected_fact,
  source_event_datetime,
  source_core_name,
  source_gate,
  raw_elapsed_time,
  raw_prize,
  raw_asset,
  source_format_label,
  raw_race_tags
)
VALUES
  (
    '90000000-0000-4000-8000-000000000701',
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000601',
    '90000000-0000-4000-8000-000000000104',
    1,
    repeat('a', 64),
    'TRUE',
    'FALSE',
    '2417.2105',
    'top2',
    true,
    '2026-07-22T12:00:00Z',
    'Synthetic Owned Core',
    1,
    '60.125',
    '7251.6315',
    'DEZ',
    'synthetic-format',
    'Water, ME'
  ),
  (
    '90000000-0000-4000-8000-000000000702',
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000602',
    '90000000-0000-4000-8000-000000000104',
    2,
    repeat('b', 64),
    'FALSE',
    'TRUE',
    '0.01',
    'winner',
    true,
    '2026-07-22T13:00:00Z',
    'Synthetic Owned Core',
    1,
    '50.250',
    '0',
    'ETH',
    'synthetic-format',
    NULL
  );

SELECT *
FROM dna.materialize_owned_race_economics(
  '90000000-0000-4000-8000-000000000104',
  '2026-07-23T00:08:00Z'
);

DO $materialization_assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.economic_transaction
    WHERE
      owner_id = '90000000-0000-4000-8000-000000000001'
      AND source_type = 'race_derived'
  ) <> 3 THEN
    RAISE EXCEPTION 'expected two DEZ and one ETH race transactions';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.economic_transaction transaction
    JOIN dna.asset_currency asset
      ON asset.owner_id = transaction.owner_id
      AND asset.id = transaction.asset_currency_id
    JOIN dna.race_economic_contribution contribution
      ON contribution.owner_id = transaction.owner_id
      AND contribution.economic_transaction_id = transaction.id
    WHERE
      transaction.owner_id = '90000000-0000-4000-8000-000000000001'
      AND asset.code = 'DEZ'
      AND contribution.transaction_type = 'entry_fee'
      AND transaction.amount_atomic = -2417210500000000000000
      AND transaction.direction = 'debit'
      AND contribution.payout_mechanism_source_value = 'top2'
      AND contribution.race_tags_source_value = 'Water, ME'
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.economic_transaction transaction
    JOIN dna.asset_currency asset
      ON asset.owner_id = transaction.owner_id
      AND asset.id = transaction.asset_currency_id
    JOIN dna.race_economic_contribution contribution
      ON contribution.owner_id = transaction.owner_id
      AND contribution.economic_transaction_id = transaction.id
    WHERE
      transaction.owner_id = '90000000-0000-4000-8000-000000000001'
      AND asset.code = 'DEZ'
      AND contribution.transaction_type = 'payout'
      AND transaction.amount_atomic = 7251631500000000000000
      AND transaction.direction = 'credit'
  ) THEN
    RAISE EXCEPTION 'exact DEZ amounts or source provenance are wrong';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.economic_transaction transaction
    JOIN dna.race_economic_contribution contribution
      ON contribution.owner_id = transaction.owner_id
      AND contribution.economic_transaction_id = transaction.id
    WHERE contribution.transaction_type = 'payout'
      AND transaction.race_entry_id =
        '90000000-0000-4000-8000-000000000602'
  ) THEN
    RAISE EXCEPTION 'zero ETH payout created a ledger row';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_event
    WHERE
      source_event_id = 'synthetic-dez-event'
      AND payout_mechanism_source_value = 'top2'
      AND race_tags_source_value = 'Water, ME'
  ) THEN
    RAISE EXCEPTION 'event payout mechanism or race tags were not retained';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.race_entry
    WHERE
      owner_id = '90000000-0000-4000-8000-000000000001'
      AND economic_data_status = 'validated'
  ) <> 2 THEN
    RAISE EXCEPTION 'accepted economic status was not materialized';
  END IF;
END
$materialization_assertions$;

SELECT *
FROM dna.materialize_owned_race_economics(
  '90000000-0000-4000-8000-000000000104',
  '2026-07-23T00:09:00Z'
);

DO $idempotence_assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.economic_transaction
    WHERE source_type = 'race_derived'
  ) <> 3 OR (
    SELECT count(*)
    FROM dna.race_economic_contribution
  ) <> 3 THEN
    RAISE EXCEPTION 'race economics replay duplicated durable records';
  END IF;
END
$idempotence_assertions$;

DO $scale_failure$
BEGIN
  BEGIN
    PERFORM dna.exact_decimal_to_atomic(0.001, 2);
    RAISE EXCEPTION 'expected exact asset-scale failure was not raised';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'amount has more decimal places%' THEN
        RAISE;
      END IF;
  END;
END
$scale_failure$;

SELECT dna.record_daily_usd_rate(
  'DEZ',
  '2026-07-22',
  0.00075,
  'coingecko',
  'coingecko:polygon-pos:contract:0xdc4f4ed9872571d5ec8986a502a0d88f3a175f1e',
  '2026-07-22T23:59:59Z',
  '2026-07-23T00:10:00Z',
  'available'
);

SELECT *
FROM dna.refresh_race_usd_valuations('2026-07-23T00:11:00Z');

DO $initial_valuation_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.current_race_economic_usd
    WHERE
      transaction_type = 'entry_fee'
      AND converted_usd_amount = -1.812907875
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.current_race_economic_usd
    WHERE
      transaction_type = 'payout'
      AND converted_usd_amount = 5.438723625
  ) THEN
    RAISE EXCEPTION 'exact DEZ daily USD multiplication is wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_economic_usd_coverage
    WHERE
      transaction_count = 3
      AND valued_transaction_count = 2
      AND missing_rate_transaction_count = 1
      AND NOT is_complete
  ) THEN
    RAISE EXCEPTION 'missing ETH rate coverage is not explicit';
  END IF;
END
$initial_valuation_assertions$;

SELECT dna.record_daily_usd_rate(
  'DEZ',
  '2026-07-22',
  0.0008,
  'manual',
  'owner:verified-daily-close:v1',
  '2026-07-22T23:59:59Z',
  '2026-07-23T00:12:00Z',
  'manual_override'
);

SELECT *
FROM dna.refresh_race_usd_valuations('2026-07-23T00:13:00Z');

DO $supersession_assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.daily_usd_rate
    WHERE rate_date = '2026-07-22'
  ) <> 2 OR (
    SELECT count(*)
    FROM dna.daily_usd_rate
    WHERE rate_date = '2026-07-22' AND is_current
  ) <> 1 THEN
    RAISE EXCEPTION 'daily-rate supersession history is wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.current_race_economic_usd
    WHERE
      transaction_type = 'entry_fee'
      AND rate_status = 'manual_override'
      AND converted_usd_amount = -1.9337684
  ) OR (
    SELECT count(*)
    FROM dna.economic_transaction_usd_valuation
    WHERE is_current
  ) <> 2 THEN
    RAISE EXCEPTION 'current valuation did not follow the manual override';
  END IF;
END
$supersession_assertions$;

DO $provider_identity_failure$
BEGIN
  BEGIN
    PERFORM dna.record_daily_usd_rate(
      'DEZ',
      '2026-07-21',
      0.0007,
      'coingecko',
      'coingecko:coin:wrong',
      '2026-07-21T23:59:59Z',
      '2026-07-23T00:14:00Z',
      'available'
    );
    RAISE EXCEPTION 'expected provider-series failure was not raised';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'CoinGecko series does not match%' THEN
        RAISE;
      END IF;
  END;
END
$provider_identity_failure$;

SELECT *
FROM dna.rollback_active_dataset(
  'race_merge',
  'synthetic economics rollback',
  '2026-07-23T00:15:00Z'
);

DO $rollback_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE
      id = '90000000-0000-4000-8000-000000000401'
      AND is_active
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '90000000-0000-4000-8000-000000000104'
      AND status = 'rolled_back'
  ) THEN
    RAISE EXCEPTION 'dataset rollback did not restore the prior version';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.race_economic_contribution
    WHERE is_selected
  ) OR EXISTS (
    SELECT 1
    FROM dna.economic_transaction
    WHERE
      source_type = 'race_derived'
      AND duplicate_status <> 'excluded'
  ) THEN
    RAISE EXCEPTION 'rolled-back race economics remained active';
  END IF;
END
$rollback_assertions$;

DO $security_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc proc
    JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(proc.proacl, acldefault('f', proc.proowner))
    ) acl
    WHERE
      namespace.nspname = 'dna'
      AND proc.proname IN (
        'materialize_owned_race_economics',
        'record_daily_usd_rate',
        'refresh_race_usd_valuations',
        'rollback_active_dataset_pre_economics'
      )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'race economics function is executable by PUBLIC';
  END IF;
END
$security_assertions$;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '90000000-0000-4000-8000-000000000002',
  'synthetic_race_economics_other_owner'
);

INSERT INTO dna.asset_currency (
  id,
  owner_id,
  code,
  display_name,
  asset_kind,
  atomic_scale
)
VALUES (
  '90000000-0000-4000-8000-000000000021',
  '90000000-0000-4000-8000-000000000002',
  'DEZ',
  'Other owner DEZ',
  'game_token',
  18
);

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
  is_current
)
VALUES (
  '90000000-0000-4000-8000-000000000801',
  '90000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000021',
  '2026-07-22',
  99,
  'manual',
  'other-owner-private-rate',
  '2026-07-22T23:59:59Z',
  '2026-07-23T00:16:00Z',
  'manual_override',
  true
);

CREATE ROLE dna_ci_race_economics NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_race_economics;
GRANT SELECT ON dna.daily_usd_rate TO dna_ci_race_economics;
GRANT EXECUTE ON FUNCTION dna.current_owner_id()
  TO dna_ci_race_economics;

SET LOCAL ROLE dna_ci_race_economics;
SET LOCAL app.owner_id = '90000000-0000-4000-8000-000000000001';

DO $rls_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.daily_usd_rate
    WHERE owner_id = '90000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'daily-rate RLS exposed another owner';
  END IF;
END
$rls_assertions$;

RESET ROLE;

ROLLBACK;

BEGIN;

SET LOCAL app.owner_id = '90000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('90000000-0000-4000-8000-000000000001', 'synthetic_economic_owner');

INSERT INTO dna.asset_currency (
  id, owner_id, code, display_name, asset_kind, atomic_scale
)
VALUES
  (
    '90000000-0000-4000-8000-000000000010',
    '90000000-0000-4000-8000-000000000001',
    'DEZ', 'DEZ', 'game_token', 6
  ),
  (
    '90000000-0000-4000-8000-000000000011',
    '90000000-0000-4000-8000-000000000001',
    'ETH', 'Ether', 'crypto', 18
  ),
  (
    '90000000-0000-4000-8000-000000000012',
    '90000000-0000-4000-8000-000000000001',
    'BGC', 'BGC', 'bgc', 2
  );

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '90000000-0000-4000-8000-000000000100',
  '90000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-race-economics.csv', repeat('9', 64),
  'utf_8', 'race-merge/v1', 'accepted',
  '2026-07-20T12:10:00Z', '2026-07-20T12:11:00Z',
  '2026-07-20T12:00:00Z', '2026-07-20T12:00:00Z',
  '2026-07-20T12:00:00Z', 3, 3, 0, 0
);

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number,
  natural_key, fingerprint_sha256, status
)
VALUES
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000100',
    1, 'synthetic-event|dez-core', repeat('1', 64), 'ready'
  ),
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000100',
    2, 'synthetic-event|eth-core', repeat('2', 64), 'ready'
  ),
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000100',
    3, 'synthetic-event|invalid-core', repeat('3', 64), 'ready'
  );

INSERT INTO dna.normalized_race_staged_fact (
  owner_id, import_batch_id, source_row_number,
  source_event_id, event_at, mode, distance,
  source_core_id, gate_count, gold_star, blue_star,
  raw_gold_star, raw_blue_star, star_data_status,
  finish_position, elapsed_time_source_value,
  source_format_label, source_race_class,
  raw_entry_fee, raw_payout, raw_prize, raw_asset,
  payout_mechanism_source_value, race_tags_source_value
)
VALUES
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000100',
    1, 'synthetic-event', '2026-07-20T12:00:00Z',
    'bike', 1000, 'dez-core', 3, false, false,
    'false', 'false', 'complete', 1, '60.0',
    'paid', 'open', '0.25', 'wta', '1.5', 'DEZ', 'wta', 'f2'
  ),
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000100',
    2, 'synthetic-event', '2026-07-20T12:00:00Z',
    'bike', 1000, 'eth-core', 3, false, false,
    'false', 'false', 'complete', 2, '61.0',
    'paid', 'open', '0.01', 'wta', '0', 'ETH', 'wta', 'f2'
  ),
  (
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000100',
    3, 'synthetic-event', '2026-07-20T12:00:00Z',
    'bike', 1000, 'invalid-core', 3, false, false,
    'false', 'false', 'complete', 3, '62.0',
    'paid', 'open', '', 'wta', '-1', 'DEZ', 'wta', 'f2'
  );

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance,
  gate_count, source_format_label, source_race_class,
  source_import_batch_id
)
VALUES (
  '90000000-0000-4000-8000-000000000200',
  '90000000-0000-4000-8000-000000000001',
  'synthetic-event', '2026-07-20T12:00:00Z',
  'bike', 1000, 3, 'paid', 'open',
  '90000000-0000-4000-8000-000000000100'
);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, finish_position,
  source_import_batch_id
)
VALUES
  (
    '90000000-0000-4000-8000-000000000301',
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000200',
    'dez-core', 3, false, false, 'complete', 1,
    '90000000-0000-4000-8000-000000000100'
  ),
  (
    '90000000-0000-4000-8000-000000000302',
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000200',
    'eth-core', 3, false, false, 'complete', 2,
    '90000000-0000-4000-8000-000000000100'
  ),
  (
    '90000000-0000-4000-8000-000000000303',
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000200',
    'invalid-core', 3, false, false, 'complete', 3,
    '90000000-0000-4000-8000-000000000100'
  );

SELECT * FROM dna.materialize_race_economics(
  '90000000-0000-4000-8000-000000000100',
  '2026-07-20T12:12:00Z'
);

DO $materialization_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.economic_transaction) <> 3
    OR NOT EXISTS (
      SELECT 1
      FROM dna.economic_transaction
      WHERE
        race_entry_id = '90000000-0000-4000-8000-000000000301'
        AND subcategory = 'race_entry_fee'
        AND direction = 'debit'
        AND amount_atomic = -250000
    )
    OR NOT EXISTS (
      SELECT 1
      FROM dna.economic_transaction
      WHERE
        race_entry_id = '90000000-0000-4000-8000-000000000301'
        AND subcategory = 'race_prize'
        AND direction = 'credit'
        AND amount_atomic = 1500000
    )
    OR NOT EXISTS (
      SELECT 1
      FROM dna.economic_transaction
      WHERE
        race_entry_id = '90000000-0000-4000-8000-000000000302'
        AND subcategory = 'race_entry_fee'
        AND direction = 'debit'
        AND amount_atomic = -10000000000000000
    )
  THEN
    RAISE EXCEPTION 'exact race fee/prize materialization failed';
  END IF;

  IF (SELECT economic_data_status FROM dna.race_entry
      WHERE id = '90000000-0000-4000-8000-000000000301') <> 'validated'
    OR (SELECT economic_data_status FROM dna.race_entry
      WHERE id = '90000000-0000-4000-8000-000000000302') <> 'validated'
    OR (SELECT economic_data_status FROM dna.race_entry
      WHERE id = '90000000-0000-4000-8000-000000000303') <> 'invalid'
    OR (SELECT count(*) FROM dna.reconciliation_issue
      WHERE reason_code = 'INVALID_RACE_ECONOMICS') <> 1
  THEN
    RAISE EXCEPTION 'race economic coverage states are incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_event
    WHERE
      id = '90000000-0000-4000-8000-000000000200'
      AND payout_mechanism_source_value = 'wta'
      AND race_tags_source_value = 'f2'
  ) THEN
    RAISE EXCEPTION 'payout mechanism or race tags were not kept separate';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.economic_transaction transaction
    JOIN dna.asset_currency asset
      ON asset.owner_id = transaction.owner_id
      AND asset.id = transaction.asset_currency_id
    WHERE asset.code = 'BGC'
  ) THEN
    RAISE EXCEPTION 'BGC entered race-derived economics';
  END IF;
END
$materialization_assertions$;

SELECT * FROM dna.materialize_race_economics(
  '90000000-0000-4000-8000-000000000100',
  '2026-07-20T12:13:00Z'
);

DO $replay_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.economic_transaction) <> 3
    OR (SELECT count(*) FROM dna.reconciliation_issue
      WHERE reason_code = 'INVALID_RACE_ECONOMICS') <> 1
  THEN
    RAISE EXCEPTION 'race economic replay was not idempotent';
  END IF;
END
$replay_assertions$;

SELECT dna.accept_daily_usd_rate(
  'DEZ', '2026-07-20', '0.125', 'coingecko',
  'coingecko:polygon-pos:contract:0xdc4f4ed9872571d5ec8986a502a0d88f3a175f1e',
  '2026-07-20T23:59:00Z', '2026-07-21T00:05:00Z', 'available'
);

SELECT dna.accept_daily_usd_rate(
  'DEZ', '2026-07-20', '0.125', 'coingecko',
  'coingecko:polygon-pos:contract:0xdc4f4ed9872571d5ec8986a502a0d88f3a175f1e',
  '2026-07-20T23:59:00Z', '2026-07-21T00:05:00Z', 'available'
);

DO $rate_conflict_assertion$
BEGIN
  BEGIN
    PERFORM dna.accept_daily_usd_rate(
      'DEZ', '2026-07-20', '0.126', 'coingecko',
      'coingecko:polygon-pos:contract:0xdc4f4ed9872571d5ec8986a502a0d88f3a175f1e',
      '2026-07-20T23:59:00Z', '2026-07-21T00:05:00Z', 'available'
    );
    RAISE EXCEPTION 'conflicting daily rate was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'conflicting daily rate was accepted' THEN
        RAISE;
      END IF;
  END;
END
$rate_conflict_assertion$;

SELECT * FROM dna.refresh_race_usd_valuations(
  '90000000-0000-4000-8000-000000000100',
  '2026-07-21T00:06:00Z'
);

DO $valuation_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.economic_transaction_usd_valuation) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM dna.economic_transaction_usd_valuation
      WHERE converted_usd_amount = -0.03125
    )
    OR NOT EXISTS (
      SELECT 1 FROM dna.economic_transaction_usd_valuation
      WHERE converted_usd_amount = 0.1875
    )
    OR (SELECT count(*) FROM dna.race_economic_usd_coverage
      WHERE valuation_status = 'available') <> 2
    OR (SELECT count(*) FROM dna.race_economic_usd_coverage
      WHERE valuation_status = 'unavailable') <> 1
  THEN
    RAISE EXCEPTION 'UTC-daily USD valuation or missing-rate coverage failed';
  END IF;
END
$valuation_assertions$;

DO $security_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE
      namespace.nspname = 'dna'
      AND relation.relname IN (
        'asset_daily_usd_rate',
        'economic_transaction_usd_valuation'
      )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'race economic tables are not protected by forced RLS';
  END IF;

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
        'accept_daily_usd_rate',
        'materialize_race_economics',
        'refresh_race_usd_valuations'
      )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'race economic functions are executable by PUBLIC';
  END IF;
END
$security_assertions$;

ROLLBACK;

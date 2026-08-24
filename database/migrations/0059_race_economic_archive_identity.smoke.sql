BEGIN;

SET LOCAL app.owner_id = '59000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '59000000-0000-4000-8000-000000000001',
  'synthetic_race_economic_archive_owner'
);

INSERT INTO dna.asset_currency (
  id, owner_id, code, display_name, asset_kind, atomic_scale
) VALUES (
  '59000000-0000-4000-8000-000000000011',
  '59000000-0000-4000-8000-000000000001',
  'DEZ', 'Synthetic DEZ', 'game_token', 18
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '59000000-0000-4000-8000-000000000101',
  '59000000-0000-4000-8000-000000000001',
  'race_merge', 'race-economic-archive.csv', repeat('5', 64),
  'utf_8', 'race-merge/v1', 'accepted',
  '2026-08-25T00:00:00Z', '2026-08-25T00:01:00Z',
  '2026-08-24T23:00:00Z', '2026-08-24T23:00:00Z',
  '2026-08-24T23:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
) VALUES (
  '59000000-0000-4000-8000-000000000201',
  '59000000-0000-4000-8000-000000000001',
  'archive-event', '2026-08-24T23:00:00Z', 'bike', 1200, 5,
  '59000000-0000-4000-8000-000000000101', true
);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, elapsed_time_milliseconds,
  speed_microunits, finish_position, economic_data_status,
  source_import_batch_id, active_in_dataset, source_fingerprint_sha256,
  payout_format_label
) VALUES (
  '59000000-0000-4000-8000-000000000301',
  '59000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000201',
  'archive-core', 5, true, false, 'complete', 60000, 20000000, 1,
  'validated', '59000000-0000-4000-8000-000000000101', true,
  decode(repeat('a', 64), 'hex'), 'synthetic-format'
);

INSERT INTO dna.economic_transaction (
  id, owner_id, natural_key, source_type, import_batch_id, race_entry_id,
  asset_currency_id, occurred_at, amount_atomic, direction, category,
  operating_effect, classification_status
) VALUES (
  '59000000-0000-4000-8000-000000000401',
  '59000000-0000-4000-8000-000000000001',
  'synthetic-race-economic-archive', 'race_derived',
  '59000000-0000-4000-8000-000000000101',
  '59000000-0000-4000-8000-000000000301',
  '59000000-0000-4000-8000-000000000011',
  '2026-08-24T23:00:00Z', 100, 'credit', 'open_race_payout',
  true, 'source_confirmed'
);

INSERT INTO dna.race_economic_contribution (
  id, owner_id, economic_transaction_id, import_batch_id, race_entry_id,
  source_row_number, transaction_type, is_selected
) VALUES (
  '59000000-0000-4000-8000-000000000501',
  '59000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000401',
  '59000000-0000-4000-8000-000000000101',
  '59000000-0000-4000-8000-000000000301',
  1, 'payout', true
);

DO $archive_identity_bound$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.economic_transaction transaction
    WHERE transaction.owner_id = '59000000-0000-4000-8000-000000000001'
      AND transaction.id = '59000000-0000-4000-8000-000000000401'
      AND transaction.race_source_event_id = 'archive-event'
      AND transaction.race_source_core_id = 'archive-core'
  ) THEN
    RAISE EXCEPTION 'race-derived transaction archive identity was not bound';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_economic_contribution contribution
    WHERE contribution.owner_id = '59000000-0000-4000-8000-000000000001'
      AND contribution.id = '59000000-0000-4000-8000-000000000501'
      AND contribution.race_source_event_id = 'archive-event'
      AND contribution.race_source_core_id = 'archive-core'
  ) THEN
    RAISE EXCEPTION 'race economic contribution archive identity was not bound';
  END IF;
END
$archive_identity_bound$;

DELETE FROM dna.race_entry
WHERE owner_id = '59000000-0000-4000-8000-000000000001'
  AND id = '59000000-0000-4000-8000-000000000301';

UPDATE dna.economic_transaction
SET notes = 'retained after synthetic race read-model compaction'
WHERE owner_id = '59000000-0000-4000-8000-000000000001'
  AND id = '59000000-0000-4000-8000-000000000401';

DO $archive_identity_survives$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.owner_id = '59000000-0000-4000-8000-000000000001'
      AND entry.id = '59000000-0000-4000-8000-000000000301'
  ) THEN
    RAISE EXCEPTION 'synthetic race entry was not compactable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.economic_transaction transaction
    WHERE transaction.owner_id = '59000000-0000-4000-8000-000000000001'
      AND transaction.id = '59000000-0000-4000-8000-000000000401'
      AND transaction.race_entry_id = '59000000-0000-4000-8000-000000000301'
      AND transaction.race_source_event_id = 'archive-event'
      AND transaction.race_source_core_id = 'archive-core'
  ) THEN
    RAISE EXCEPTION 'durable race-derived transaction did not survive read-model compaction';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_economic_contribution contribution
    WHERE contribution.owner_id = '59000000-0000-4000-8000-000000000001'
      AND contribution.id = '59000000-0000-4000-8000-000000000501'
      AND contribution.race_entry_id = '59000000-0000-4000-8000-000000000301'
      AND contribution.race_source_event_id = 'archive-event'
      AND contribution.race_source_core_id = 'archive-core'
  ) THEN
    RAISE EXCEPTION 'durable race economic contribution did not survive read-model compaction';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.current_race_economic_usd current
    WHERE current.owner_id = '59000000-0000-4000-8000-000000000001'
      AND current.economic_transaction_id = '59000000-0000-4000-8000-000000000401'
  ) THEN
    RAISE EXCEPTION 'race economic reporting stopped after read-model compaction';
  END IF;
END
$archive_identity_survives$;

DO $archive_identity_immutable$
BEGIN
  BEGIN
    UPDATE dna.economic_transaction
    SET race_source_core_id = 'tampered-core'
    WHERE owner_id = '59000000-0000-4000-8000-000000000001'
      AND id = '59000000-0000-4000-8000-000000000401';
    RAISE EXCEPTION 'archive identity mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'archive identity mutation unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF SQLERRM <> 'race-derived transaction archive identity is immutable' THEN
      RAISE;
    END IF;
  END;
END
$archive_identity_immutable$;

DO $missing_entry_rejected$
BEGIN
  BEGIN
    INSERT INTO dna.economic_transaction (
      id, owner_id, natural_key, source_type, import_batch_id, race_entry_id,
      asset_currency_id, occurred_at, amount_atomic, direction, category,
      operating_effect, classification_status
    ) VALUES (
      '59000000-0000-4000-8000-000000000402',
      '59000000-0000-4000-8000-000000000001',
      'synthetic-race-economic-missing-entry', 'race_derived',
      '59000000-0000-4000-8000-000000000101',
      '59000000-0000-4000-8000-000000000399',
      '59000000-0000-4000-8000-000000000011',
      '2026-08-24T23:00:00Z', 10, 'credit', 'open_race_payout',
      true, 'source_confirmed'
    );
    RAISE EXCEPTION 'missing race entry unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'missing race entry unexpectedly accepted' THEN
      RAISE;
    END IF;
    IF SQLERRM <> 'race-derived transaction race entry is unavailable' THEN
      RAISE;
    END IF;
  END;
END
$missing_entry_rejected$;

ROLLBACK;
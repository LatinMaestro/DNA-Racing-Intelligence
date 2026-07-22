BEGIN;

SET LOCAL app.owner_id = '00000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'synthetic_clerk_owner'
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
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000001',
    'BGC',
    'Synthetic BGC',
    'bgc',
    0
  ),
  (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000001',
    'DEZ',
    'Synthetic DEZ',
    'game_token',
    6
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
VALUES (
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000001',
  'race_merge',
  'synthetic-race-merge.csv',
  repeat('a', 64),
  'utf_8',
  'race-merge/v1',
  'accepted',
  '2026-07-22T10:00:00Z',
  '2026-07-22T10:01:00Z',
  '2026-07-20T10:00:00Z',
  '2026-07-21T10:00:00Z',
  '2026-07-21T10:00:00Z',
  2,
  2,
  0,
  1
);

INSERT INTO dna.dataset_version (
  id,
  owner_id,
  source_type,
  version_number,
  import_batch_id,
  activated_at,
  data_current_through,
  aggregate_refreshed_at,
  is_active
)
VALUES (
  '00000000-0000-4000-8000-000000000030',
  '00000000-0000-4000-8000-000000000001',
  'race_merge',
  1,
  '00000000-0000-4000-8000-000000000020',
  '2026-07-22T10:01:00Z',
  '2026-07-21T10:00:00Z',
  '2026-07-22T10:02:00Z',
  true
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
  '00000000-0000-4000-8000-000000000040',
  '00000000-0000-4000-8000-000000000001',
  'synthetic-core-1',
  'Synthetic Core One',
  'Morphed',
  'Fire',
  3,
  'female',
  '00000000-0000-4000-8000-000000000020'
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
  source_race_class,
  source_import_batch_id
)
VALUES (
  '00000000-0000-4000-8000-000000000050',
  '00000000-0000-4000-8000-000000000001',
  'synthetic-event-1',
  '2026-07-21T10:00:00Z',
  'horse',
  1600,
  3,
  'synthetic-open',
  'legacy-ignored',
  '00000000-0000-4000-8000-000000000020'
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
  elapsed_time_milliseconds,
  speed_microunits,
  finish_position,
  economic_data_status,
  source_import_batch_id
)
VALUES (
  '00000000-0000-4000-8000-000000000060',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000050',
  'synthetic-core-1',
  '00000000-0000-4000-8000-000000000040',
  3,
  true,
  true,
  'complete',
  91000,
  1750000,
  1,
  'unvalidated',
  '00000000-0000-4000-8000-000000000020'
);

INSERT INTO dna.event_star_validation (
  id,
  owner_id,
  race_event_id,
  gate_count,
  gold_assignment_count,
  blue_assignment_count,
  gold_source_core_id,
  blue_source_core_id,
  same_core_received_both,
  validation_status,
  warning_codes,
  refreshed_at
)
VALUES (
  '00000000-0000-4000-8000-000000000070',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000050',
  3,
  1,
  1,
  'synthetic-core-1',
  'synthetic-core-1',
  true,
  'warning',
  ARRAY['GOLD_INELIGIBLE_ASSIGNMENT'],
  '2026-07-22T10:02:00Z'
);

INSERT INTO dna.manual_star_observation (
  id,
  owner_id,
  reconciliation_key,
  key_authority,
  authoritative_source_event_id,
  event_starts_at,
  mode,
  distance,
  gate_count,
  observed_gold_source_core_id,
  observed_blue_source_core_id,
  observed_at,
  warning_codes
)
VALUES (
  '00000000-0000-4000-8000-000000000080',
  '00000000-0000-4000-8000-000000000001',
  'manual_star_event|17:synthetic-event-1',
  'authoritative_event_id',
  'synthetic-event-1',
  '2026-07-21T10:00:00Z',
  'horse',
  1600,
  3,
  'synthetic-core-1',
  'synthetic-core-1',
  '2026-07-21T09:59:00Z',
  ARRAY['GOLD_INELIGIBLE_ASSIGNMENT']
);

INSERT INTO dna.economic_transaction (
  id,
  owner_id,
  natural_key,
  source_type,
  asset_currency_id,
  occurred_at,
  amount_atomic,
  direction,
  category,
  operating_effect,
  classification_status
)
VALUES
  (
    '00000000-0000-4000-8000-000000000090',
    '00000000-0000-4000-8000-000000000001',
    'synthetic-bgc-credit',
    'manual',
    '00000000-0000-4000-8000-000000000010',
    '2026-07-21T12:00:00Z',
    500,
    'credit',
    'bgc_burn_credit',
    true,
    'manual'
  ),
  (
    '00000000-0000-4000-8000-000000000091',
    '00000000-0000-4000-8000-000000000001',
    'synthetic-transfer',
    'manual',
    '00000000-0000-4000-8000-000000000011',
    '2026-07-21T12:00:00Z',
    -1000000,
    'debit',
    'internal_transfer',
    false,
    'manual'
  );

DO $assertions$
BEGIN
  IF (
    SELECT gold_star_eligible
    FROM dna.race_entry
    WHERE id = '00000000-0000-4000-8000-000000000060'
  ) THEN
    RAISE EXCEPTION 'Three-gate race entry must be Gold-ineligible';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.event_star_validation
    WHERE
      race_event_id = '00000000-0000-4000-8000-000000000050'
      AND warning_codes @> ARRAY['GOLD_INELIGIBLE_ASSIGNMENT']
  ) THEN
    RAISE EXCEPTION 'Ineligible source Gold assignment must remain reviewable';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.economic_transaction transaction
    JOIN dna.asset_currency asset
      ON asset.owner_id = transaction.owner_id
      AND asset.id = transaction.asset_currency_id
    WHERE
      transaction.operating_effect
      AND asset.asset_kind <> 'bgc'
  ) <> 0 THEN
    RAISE EXCEPTION 'Synthetic transfer entered operating cashflow';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.manual_star_observation
    WHERE reconciliation_status = 'pending'
  ) <> 1 THEN
    RAISE EXCEPTION 'Manual observation must remain separate and pending';
  END IF;
END
$assertions$;

DELETE FROM dna.core
WHERE id = '00000000-0000-4000-8000-000000000040';

DO $deletion_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry
    WHERE
      id = '00000000-0000-4000-8000-000000000060'
      AND owner_id = '00000000-0000-4000-8000-000000000001'
      AND core_id IS NULL
      AND source_core_id = 'synthetic-core-1'
  ) THEN
    RAISE EXCEPTION 'Core deletion did not preserve owner-scoped race provenance';
  END IF;
END
$deletion_assertions$;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'synthetic_other_owner'
);

CREATE ROLE dna_ci_app NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_app;
GRANT SELECT ON ALL TABLES IN SCHEMA dna TO dna_ci_app;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_app;

SET LOCAL ROLE dna_ci_app;
SET LOCAL app.owner_id = '00000000-0000-4000-8000-000000000001';

DO $rls_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.app_owner) <> 1 THEN
    RAISE EXCEPTION 'Owner row-level security exposed another owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.app_owner
    WHERE id = '00000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Owner row-level security failed closed-read isolation';
  END IF;
END
$rls_assertions$;

RESET ROLE;

ROLLBACK;

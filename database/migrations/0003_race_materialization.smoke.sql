BEGIN;

SET LOCAL app.owner_id = '30000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  'synthetic_race_materialization_owner'
);

INSERT INTO dna.core (
  id,
  owner_id,
  source_core_id,
  display_name
)
VALUES (
  '30000000-0000-4000-8000-000000000010',
  '30000000-0000-4000-8000-000000000001',
  'synthetic-core-a',
  'Synthetic Core A'
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
  minimum_accepted_event_at,
  maximum_accepted_event_at,
  source_rows,
  accepted_rows,
  rejected_rows,
  warning_rows
)
VALUES
  (
    '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-race-materialization-1.csv',
    repeat('a', 64),
    'utf_8',
    'race-merge/v1',
    'validating',
    '2026-07-23T03:00:00Z',
    '2026-07-23T01:00:00Z',
    '2026-07-23T02:00:00Z',
    6,
    0,
    6,
    0
  ),
  (
    '30000000-0000-4000-8000-000000000102',
    '30000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-race-materialization-2.csv',
    repeat('b', 64),
    'utf_8',
    'race-merge/v1',
    'validating',
    '2026-07-23T04:00:00Z',
    '2026-07-23T01:00:00Z',
    '2026-07-23T03:00:00Z',
    3,
    0,
    3,
    0
  ),
  (
    '30000000-0000-4000-8000-000000000103',
    '30000000-0000-4000-8000-000000000001',
    'race_merge',
    'synthetic-missing-normalized-fact.csv',
    repeat('c', 64),
    'utf_8',
    'race-merge/v1',
    'validating',
    '2026-07-23T05:00:00Z',
    '2026-07-23T04:00:00Z',
    '2026-07-23T04:00:00Z',
    1,
    0,
    1,
    0
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
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 1, 'race-entry-event-1-core-a', repeat('1', 64), 'ready', '{}'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 2, 'race-entry-event-1-core-b', repeat('2', 64), 'ready', '{}'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 3, 'race-entry-event-2-core-a', repeat('3', 64), 'ready', ARRAY['GOLD_INELIGIBLE_ASSIGNMENT']),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 4, 'race-entry-event-2-core-b', repeat('4', 64), 'ready', '{}'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 5, 'race-entry-event-conflict-core-a', repeat('5', 64), 'ready', '{}'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 6, 'race-entry-event-conflict-core-b', repeat('6', 64), 'ready', '{}'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000102', 1, 'race-entry-event-1-core-a', repeat('1', 64), 'ready', '{}'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000102', 2, 'race-entry-event-3-core-c', repeat('7', 64), 'ready', '{}'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000102', 3, 'race-entry-event-1-core-c', repeat('8', 64), 'ready', '{}'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000103', 1, 'race-entry-event-4-core-d', repeat('9', 64), 'ready', '{}');

INSERT INTO dna.normalized_race_staged_fact (
  owner_id,
  import_batch_id,
  source_row_number,
  source_event_id,
  event_at,
  source_event_datetime,
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
  source_race_class,
  raw_entry_fee,
  raw_payout,
  raw_prize,
  raw_asset
)
VALUES
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 1,
    'synthetic-event-1', '2026-07-23T01:00:00Z', '2026-07-23T01:00:00Z',
    'bike', 1000, 'synthetic-core-a', 'Synthetic Core A', 1, 4,
    true, false, 'TRUE', 'FALSE', 'complete', 1, '52.500',
    'synthetic-format', 'obsolete-class', '0.01', '0.04', '0.04', 'USD'
  ),
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 2,
    'synthetic-event-1', '2026-07-23T01:00:00Z', '2026-07-23T01:00:00Z',
    'bike', 1000, 'synthetic-core-b', 'Synthetic Core B', 2, 4,
    false, true, 'FALSE', 'TRUE', 'complete', 2, '52.750',
    'synthetic-format', 'obsolete-class', '0.01', '0', '0.04', 'USD'
  ),
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 3,
    'synthetic-event-2', '2026-07-23T02:00:00Z', NULL,
    'horse', 1600, 'synthetic-core-a', 'Synthetic Core A', 1, 3,
    true, false, 'TRUE', 'FALSE', 'complete', 1, '91.125',
    NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 4,
    'synthetic-event-2', '2026-07-23T02:00:00Z', NULL,
    'horse', 1600, 'synthetic-core-b', 'Synthetic Core B', 2, 3,
    false, false, 'FALSE', 'FALSE', 'complete', 2, '91.500',
    NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 5,
    'synthetic-event-conflict', '2026-07-23T02:30:00Z', NULL,
    'car', 1000, 'synthetic-core-a', NULL, 1, 4,
    false, false, 'FALSE', 'FALSE', 'complete', 1, '50.000',
    NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 6,
    'synthetic-event-conflict', '2026-07-23T02:30:00Z', NULL,
    'car', 1200, 'synthetic-core-b', NULL, 2, 4,
    false, false, 'FALSE', 'FALSE', 'complete', 2, '60.000',
    NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000102', 1,
    'synthetic-event-1', '2026-07-23T01:00:00Z', '2026-07-23T01:00:00Z',
    'bike', 1000, 'synthetic-core-a', 'Synthetic Core A', 1, 4,
    true, false, 'TRUE', 'FALSE', 'complete', 1, '52.500',
    'synthetic-format', 'obsolete-class', '0.01', '0.04', '0.04', 'USD'
  ),
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000102', 2,
    'synthetic-event-3', '2026-07-23T03:00:00Z', NULL,
    'car', 1400, 'synthetic-core-c', 'Synthetic Core C', 1, 4,
    false, true, 'FALSE', 'TRUE', 'complete', 1, '70.000',
    NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000102', 3,
    'synthetic-event-1', '2026-07-23T01:00:00Z', NULL,
    'bike', 1200, 'synthetic-core-c', 'Synthetic Core C', 3, 4,
    false, false, 'FALSE', 'FALSE', 'complete', 3, '62.000',
    NULL, NULL, NULL, NULL, NULL, NULL
  );

SELECT *
FROM dna.accept_staged_race_dataset(
  '30000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000201',
  '2026-07-23T03:02:00Z',
  '2026-07-23T03:03:00Z',
  '2026-07-23T02:00:00Z'
);

DO $first_acceptance$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '30000000-0000-4000-8000-000000000101'
      AND status = 'accepted'
      AND accepted_rows = 4
      AND rejected_rows = 2
      AND warning_rows = 3
  ) THEN
    RAISE EXCEPTION 'Race batch counts or event-conflict quarantine are wrong';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.race_event
    WHERE owner_id = '30000000-0000-4000-8000-000000000001'
      AND active_in_dataset
  ) <> 2 OR (
    SELECT count(*)
    FROM dna.race_entry
    WHERE owner_id = '30000000-0000-4000-8000-000000000001'
      AND active_in_dataset
  ) <> 4 THEN
    RAISE EXCEPTION 'Accepted normalized race facts were not materialized';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.race_event
    WHERE source_event_id = 'synthetic-event-conflict'
  ) THEN
    RAISE EXCEPTION 'Conflicting event metadata was materialized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_event
    WHERE
      source_event_id = 'synthetic-event-2'
      AND gate_count = 3
      AND NOT gold_star_eligible
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    JOIN dna.race_event event ON event.id = entry.race_event_id
    WHERE
      event.source_event_id = 'synthetic-event-2'
      AND entry.source_core_id = 'synthetic-core-a'
      AND entry.gold_star
      AND NOT entry.gold_star_eligible
  ) THEN
    RAISE EXCEPTION 'Ineligible source Gold was not preserved with derived eligibility';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    JOIN dna.race_event event ON event.id = entry.race_event_id
    WHERE
      event.source_event_id = 'synthetic-event-1'
      AND entry.source_core_id = 'synthetic-core-a'
      AND entry.core_id = '30000000-0000-4000-8000-000000000010'
      AND entry.elapsed_time_milliseconds IS NULL
      AND entry.speed_microunits IS NULL
      AND entry.economic_data_status = 'unvalidated'
  ) THEN
    RAISE EXCEPTION 'Race identity link or deferred semantic boundary is wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry_source
    WHERE
      import_batch_id = '30000000-0000-4000-8000-000000000101'
      AND raw_elapsed_time = '52.500'
      AND raw_entry_fee = '0.01'
      AND raw_payout = '0.04'
      AND raw_prize = '0.04'
      AND raw_asset = 'USD'
  ) THEN
    RAISE EXCEPTION 'Deferred source semantics or provenance were not retained';
  END IF;
END
$first_acceptance$;

SELECT *
FROM dna.accept_staged_race_dataset(
  '30000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000299',
  '2026-07-23T03:02:00Z',
  '2026-07-23T03:03:00Z',
  '2026-07-23T02:00:00Z'
);

DO $idempotent_assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.dataset_version
    WHERE source_type = 'race_merge'
  ) <> 1 OR (
    SELECT count(*)
    FROM dna.race_entry_source
    WHERE import_batch_id = '30000000-0000-4000-8000-000000000101'
  ) <> 4 THEN
    RAISE EXCEPTION 'Idempotent materialization duplicated versions or provenance';
  END IF;
END
$idempotent_assertions$;

SELECT *
FROM dna.accept_staged_race_dataset(
  '30000000-0000-4000-8000-000000000102',
  '30000000-0000-4000-8000-000000000202',
  '2026-07-23T04:02:00Z',
  '2026-07-23T04:03:00Z',
  '2026-07-23T03:00:00Z'
);

DO $second_acceptance$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '30000000-0000-4000-8000-000000000102'
      AND status = 'accepted'
      AND accepted_rows = 1
      AND rejected_rows = 2
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.race_event
    WHERE source_event_id = 'synthetic-event-3' AND active_in_dataset
  ) THEN
    RAISE EXCEPTION 'Cross-batch event conflict or new fact materialization is wrong';
  END IF;
END
$second_acceptance$;

SELECT *
FROM dna.rollback_active_dataset(
  'race_merge',
  'synthetic materialization rollback',
  '2026-07-23T04:10:00Z'
);

DO $rollback_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version
    WHERE
      id = '30000000-0000-4000-8000-000000000201'
      AND is_active
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.race_event
    WHERE source_event_id = 'synthetic-event-3' AND NOT active_in_dataset
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.race_entry
    WHERE source_core_id = 'synthetic-core-c' AND NOT active_in_dataset
  ) OR (
    SELECT count(*)
    FROM dna.race_entry
    WHERE active_in_dataset
  ) <> 4 THEN
    RAISE EXCEPTION 'Race rollback did not restore the prior active fact set';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry_source
    WHERE
      import_batch_id = '30000000-0000-4000-8000-000000000102'
      AND NOT is_selected_fact
  ) THEN
    RAISE EXCEPTION 'Rolled-back race provenance remained selected';
  END IF;
END
$rollback_assertions$;

DO $missing_fact_failure$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.accept_staged_race_dataset(
      '30000000-0000-4000-8000-000000000103',
      '30000000-0000-4000-8000-000000000203',
      '2026-07-23T05:02:00Z',
      '2026-07-23T05:03:00Z',
      '2026-07-23T04:00:00Z'
    );
    RAISE EXCEPTION 'expected normalized-fact completeness failure was not raised';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'every ready Race Merge row requires%' THEN
        RAISE;
      END IF;
  END;
END
$missing_fact_failure$;

DO $security_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc proc
    JOIN pg_namespace ns ON ns.oid = proc.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(proc.proacl, acldefault('f', proc.proowner))
    ) acl
    WHERE
      ns.nspname = 'dna'
      AND proc.proname IN (
        'accept_staged_race_dataset',
        'rollback_active_dataset',
        'rollback_active_dataset_ledger'
      )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Race materialization function is executable by PUBLIC';
  END IF;
END
$security_assertions$;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '30000000-0000-4000-8000-000000000002',
  'synthetic_race_materialization_other_owner'
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
  source_rows,
  accepted_rows,
  rejected_rows,
  warning_rows
)
VALUES (
  '30000000-0000-4000-8000-000000000104',
  '30000000-0000-4000-8000-000000000002',
  'race_merge',
  'synthetic-other-owner.csv',
  repeat('d', 64),
  'utf_8',
  'race-merge/v1',
  'validating',
  '2026-07-23T05:00:00Z',
  1,
  0,
  1,
  0
);

INSERT INTO dna.dataset_staged_record (
  owner_id,
  import_batch_id,
  source_row_number,
  natural_key,
  fingerprint_sha256,
  status
)
VALUES (
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000104',
  1,
  'other-owner-race-entry',
  repeat('e', 64),
  'quarantined'
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
  gate_count,
  gold_star,
  blue_star,
  raw_gold_star,
  raw_blue_star,
  star_data_status,
  finish_position,
  elapsed_time_source_value
)
VALUES (
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000104',
  1,
  'other-owner-event',
  '2026-07-23T04:00:00Z',
  'bike',
  1000,
  'other-owner-core',
  4,
  false,
  false,
  'FALSE',
  'FALSE',
  'complete',
  1,
  '50.000'
);

CREATE ROLE dna_ci_race_materialization NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_race_materialization;
GRANT SELECT ON dna.normalized_race_staged_fact TO dna_ci_race_materialization;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_race_materialization;

SET LOCAL ROLE dna_ci_race_materialization;
SET LOCAL app.owner_id = '30000000-0000-4000-8000-000000000001';

DO $rls_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.normalized_race_staged_fact
    WHERE owner_id = '30000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Normalized race staging RLS exposed another owner';
  END IF;
END
$rls_assertions$;

RESET ROLE;

ROLLBACK;

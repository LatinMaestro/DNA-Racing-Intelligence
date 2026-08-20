BEGIN;

SET LOCAL app.owner_id = '35000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('35000000-0000-4000-8000-000000000001', 'synthetic_payout_format_owner'),
  ('35000000-0000-4000-8000-000000000002', 'synthetic_payout_format_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
)
VALUES (
  '35000000-0000-4000-8000-000000000101',
  '35000000-0000-4000-8000-000000000001',
  'race_merge',
  'synthetic-payout-format.csv',
  repeat('1', 64),
  'utf_8',
  'race-merge/v1',
  'accepted',
  '2026-08-20T00:00:00Z',
  '2026-08-20T00:05:00Z',
  '2026-08-20T00:01:00Z',
  '2026-08-20T00:03:00Z',
  '2026-08-20T00:03:00Z',
  3, 3, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
)
VALUES (
  '35000000-0000-4000-8000-000000000201',
  '35000000-0000-4000-8000-000000000001',
  'race_merge',
  1,
  '35000000-0000-4000-8000-000000000101',
  '2026-08-20T00:06:00Z',
  '2026-08-20T00:03:00Z',
  true
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
)
VALUES
  ('35000000-0000-4000-8000-000000000301', '35000000-0000-4000-8000-000000000001', 'format-event-one', '2026-08-20T00:01:00Z', 'bike', 1050, 4, '35000000-0000-4000-8000-000000000101', true),
  ('35000000-0000-4000-8000-000000000302', '35000000-0000-4000-8000-000000000001', 'format-event-two', '2026-08-20T00:02:00Z', 'bike', 1200, 4, '35000000-0000-4000-8000-000000000101', true),
  ('35000000-0000-4000-8000-000000000303', '35000000-0000-4000-8000-000000000001', 'format-event-three', '2026-08-20T00:03:00Z', 'bike', 1050, 4, '35000000-0000-4000-8000-000000000101', true);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, finish_position,
  elapsed_time_milliseconds, speed_microunits,
  source_import_batch_id, active_in_dataset
)
VALUES
  ('35000000-0000-4000-8000-000000000401', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000301', 'format-core', 4, true, true, 'complete', 1, 50000, 21000000, '35000000-0000-4000-8000-000000000101', true),
  ('35000000-0000-4000-8000-000000000402', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000302', 'format-core', 4, true, false, 'complete', 3, 60000, 20000000, '35000000-0000-4000-8000-000000000101', true),
  ('35000000-0000-4000-8000-000000000403', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000303', 'format-core', 4, false, false, 'complete', 4, 51000, 20588235, '35000000-0000-4000-8000-000000000101', true);

INSERT INTO dna.race_entry_source (
  id, owner_id, race_entry_id, import_batch_id, source_row_number,
  source_row_checksum, raw_gold_star, raw_blue_star, raw_elapsed_time,
  raw_payout, is_selected_fact
)
VALUES
  ('35000000-0000-4000-8000-000000000501', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000401', '35000000-0000-4000-8000-000000000101', 1, repeat('2', 64), 'true', 'true', '50.000', 'Top 3', true),
  ('35000000-0000-4000-8000-000000000502', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000402', '35000000-0000-4000-8000-000000000101', 2, repeat('3', 64), 'true', 'false', '60.000', ' top   3 ', true),
  ('35000000-0000-4000-8000-000000000503', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000403', '35000000-0000-4000-8000-000000000101', 3, repeat('4', 64), 'false', 'false', '51.000', 'Winner Take All', true);

INSERT INTO dna.core (id, owner_id, source_core_id, display_name, source_import_batch_id)
VALUES (
  '35000000-0000-4000-8000-000000000601',
  '35000000-0000-4000-8000-000000000001',
  'format-core',
  'Format Core',
  '35000000-0000-4000-8000-000000000101'
);

INSERT INTO dna.owner_vault_core (
  id, owner_id, core_id, in_my_vault, me_eligible, version, created_at, updated_at
)
VALUES (
  '35000000-0000-4000-8000-000000000701',
  '35000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000601',
  true,
  false,
  1,
  '2026-08-20T00:07:00Z',
  '2026-08-20T00:07:00Z'
);

SELECT * FROM dna.refresh_core_payout_format_profiles('2026-08-20T00:10:00Z');
SELECT * FROM dna.refresh_core_payout_format_profiles('2026-08-20T00:11:00Z');

DO $payout_format_assertions$
BEGIN
  IF dna.payout_format_key(' Top   3 ') <> 'top 3' THEN
    RAISE EXCEPTION 'payout-format key normalization is not conservative and deterministic';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.core_payout_format_profile
    WHERE owner_id = '35000000-0000-4000-8000-000000000001'
  ) <> 2 THEN
    RAISE EXCEPTION 'exact replay did not preserve two bounded format profiles';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.core_payout_format_profile
    WHERE
      source_core_id = 'format-core'
      AND mode = 'bike'
      AND payout_format_key = 'top 3'
      AND race_count = 2
      AND win_count = 1
      AND top_three_count = 2
      AND exact_distance_count = 2
      AND timed_race_count = 2
      AND first_event_at = '2026-08-20T00:01:00Z'
      AND data_current_through = '2026-08-20T00:02:00Z'
  ) THEN
    RAISE EXCEPTION 'Top 3 format profile numerators or coverage are wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.core_payout_format_profile
    WHERE
      source_core_id = 'format-core'
      AND payout_format_key = 'winner take all'
      AND race_count = 1
      AND win_count = 0
      AND top_three_count = 0
  ) THEN
    RAISE EXCEPTION 'Winner Take All format profile is wrong';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.list_core_payout_format_profiles(
      '35000000-0000-4000-8000-000000000001',
      NULL,
      5000
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'owner Vault payout-format read did not return two profiles';
  END IF;
END
$payout_format_assertions$;

CREATE ROLE dna_ci_payout_format NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_payout_format;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_payout_format;
GRANT EXECUTE ON FUNCTION dna.list_core_payout_format_profiles(
  uuid,
  text,
  integer
) TO dna_ci_payout_format;

SET LOCAL ROLE dna_ci_payout_format;
SET LOCAL app.owner_id = '35000000-0000-4000-8000-000000000002';

DO $isolation_assertions$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.list_core_payout_format_profiles(
      '35000000-0000-4000-8000-000000000001',
      'format-core',
      10
    );
    RAISE EXCEPTION 'cross-owner payout-format read was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner payout-format read was allowed' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM * FROM dna.core_payout_format_profile;
    RAISE EXCEPTION 'runtime role received direct payout-format table access';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$isolation_assertions$;

RESET ROLE;
ROLLBACK;

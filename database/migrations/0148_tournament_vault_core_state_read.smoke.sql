BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1480000-0000-4000-8000-000000000001', 'smoke_tournament_vault_owner'),
  ('a1480000-0000-4000-8000-000000000002', 'smoke_tournament_vault_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  schema_version, status, uploaded_at, import_completed_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  'a1480000-0000-4000-8000-000000000010',
  'a1480000-0000-4000-8000-000000000001',
  'core_details', 'tournament-vault-state-smoke.csv', repeat('a', 64),
  'smoke-v1', 'accepted', '2026-10-20T00:00:00Z',
  '2026-10-20T00:01:00Z', 1, 1, 0, 0
);

INSERT INTO dna.core (
  id, owner_id, source_core_id, display_name, core_class, element,
  f_number, sex, source_import_batch_id
) VALUES (
  'a1480000-0000-4000-8000-000000000020',
  'a1480000-0000-4000-8000-000000000001',
  'core-tournament-smoke', 'Tournament Smoke Core', 'Genesis', 'Fire',
  1, 'female', 'a1480000-0000-4000-8000-000000000010'
);

INSERT INTO dna.core_import_provenance (
  id, owner_id, core_id, import_batch_id, source_row_number,
  raw_source_core_id, raw_source_name, is_selected_fact
) VALUES (
  'a1480000-0000-4000-8000-000000000030',
  'a1480000-0000-4000-8000-000000000001',
  'a1480000-0000-4000-8000-000000000020',
  'a1480000-0000-4000-8000-000000000010',
  1, 'core-tournament-smoke', 'Tournament Smoke Core', true
);

INSERT INTO dna.owner_vault_core (
  id, owner_id, core_id, in_my_vault, me_eligible, version,
  created_at, updated_at
) VALUES (
  'a1480000-0000-4000-8000-000000000040',
  'a1480000-0000-4000-8000-000000000001',
  'a1480000-0000-4000-8000-000000000020',
  true, true, 1, '2026-10-20T00:02:00Z', '2026-10-20T00:02:00Z'
);

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.active_core_details', 'SELECT')
    OR NOT has_function_privilege(
      'dna_app_runtime',
      'dna.list_tournament_vault_core_state(uuid)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'Tournament Vault Core state read privileges are unsafe';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1480000-0000-4000-8000-000000000001';

DO $read$
BEGIN
  IF (SELECT count(*)
      FROM dna.list_tournament_vault_core_state(
        'a1480000-0000-4000-8000-000000000001'
      )
      WHERE source_core_id = 'core-tournament-smoke'
        AND core_class = 'Genesis'
        AND element = 'Fire'
        AND f_number = 1
        AND core_details_active
        AND me_eligible) <> 1 THEN
    RAISE EXCEPTION 'Tournament Vault Core state read is invalid';
  END IF;

  BEGIN
    PERFORM dna.list_tournament_vault_core_state(
      'a1480000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'Cross-owner Tournament Vault Core state read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner Tournament Vault Core state read accepted' THEN
      RAISE;
    END IF;
  END;
END
$read$;

RESET ROLE;
ROLLBACK;

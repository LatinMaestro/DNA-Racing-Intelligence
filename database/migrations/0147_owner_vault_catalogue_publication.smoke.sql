BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1470000-0000-4000-8000-000000000001', 'smoke_vault_publication_owner'),
  ('a1470000-0000-4000-8000-000000000002', 'smoke_vault_publication_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  schema_version, status, uploaded_at, import_completed_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  'a1470000-0000-4000-8000-000000000010',
  'a1470000-0000-4000-8000-000000000001',
  'core_details', 'vault-publication-smoke.csv', repeat('a', 64), 'smoke-v1',
  'accepted', '2026-10-20T00:00:00Z', '2026-10-20T00:01:00Z',
  1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, aggregate_refreshed_at, is_active
) VALUES (
  'a1470000-0000-4000-8000-000000000020',
  'a1470000-0000-4000-8000-000000000001',
  'core_details', 1, 'a1470000-0000-4000-8000-000000000010',
  '2026-10-20T00:01:00Z', '2026-10-20T00:02:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at, completed_at,
  affected_record_count
) VALUES (
  'a1470000-0000-4000-8000-000000000030',
  'a1470000-0000-4000-8000-000000000001',
  'a1470000-0000-4000-8000-000000000020',
  'completed', '2026-10-20T00:01:30Z', '2026-10-20T00:02:00Z', 1
);

INSERT INTO dna.dataset_version_evidence_receipt (
  owner_id, dataset_version_id, import_batch_id, source_type,
  evidence_kind, evidence_partition_count, evidence_row_count,
  evidence_byte_size, sealed_at
) VALUES (
  'a1470000-0000-4000-8000-000000000001',
  'a1470000-0000-4000-8000-000000000020',
  'a1470000-0000-4000-8000-000000000010',
  'core_details', 'staged_rows', 1, 1, 128, '2026-10-20T00:02:30Z'
);

INSERT INTO dna.core (
  id, owner_id, source_core_id, display_name, core_class, element,
  f_number, sex, source_import_batch_id
) VALUES (
  'a1470000-0000-4000-8000-000000000040',
  'a1470000-0000-4000-8000-000000000001',
  'core-smoke', 'Smoke Core', 'Genesis', 'Fire', 1, 'female',
  'a1470000-0000-4000-8000-000000000010'
);

INSERT INTO dna.core_import_provenance (
  id, owner_id, core_id, import_batch_id, source_row_number,
  raw_source_core_id, raw_source_name, is_selected_fact
) VALUES (
  'a1470000-0000-4000-8000-000000000050',
  'a1470000-0000-4000-8000-000000000001',
  'a1470000-0000-4000-8000-000000000040',
  'a1470000-0000-4000-8000-000000000010',
  1, 'core-smoke', 'Smoke Core', true
);

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.import_batch', 'SELECT')
    OR has_table_privilege('dna_app_runtime', 'dna.dataset_version', 'SELECT')
    OR has_table_privilege('dna_app_runtime',
      'dna.dataset_version_evidence_receipt', 'SELECT')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_owner_vault_catalogue_publication(uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Vault catalogue publication read privileges are unsafe';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1470000-0000-4000-8000-000000000001';

DO $read$
DECLARE
  v_owner constant uuid := 'a1470000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT count(*)
      FROM dna.read_owner_vault_catalogue_publication(v_owner)
      WHERE core_dataset_version_id =
          'a1470000-0000-4000-8000-000000000020'
        AND import_batch_id = 'a1470000-0000-4000-8000-000000000010'
        AND source_sha256 = repeat('a', 64)
        AND source_row_count = 1
        AND accepted_row_count = 1
        AND core_count = 1
        AND evidence_row_count = 1
        AND aggregate_refreshed_at = '2026-10-20T00:02:00Z'
        AND evidence_sealed_at = '2026-10-20T00:02:30Z') <> 1 THEN
    RAISE EXCEPTION 'Vault catalogue publication identity is invalid';
  END IF;

  BEGIN
    PERFORM dna.read_owner_vault_catalogue_publication(
      'a1470000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Cross-owner Vault catalogue publication read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner Vault catalogue publication read accepted' THEN
      RAISE;
    END IF;
  END;
END
$read$;

RESET ROLE;
ROLLBACK;

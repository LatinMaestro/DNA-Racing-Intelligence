BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('59000000-0000-4000-8000-000000000001', 'locator-owner'),
  ('59000000-0000-4000-8000-000000000002', 'locator-other-owner');

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
) VALUES (
  '59000000-0000-4000-8000-000000000010',
  '59000000-0000-4000-8000-000000000001',
  'race_merge',
  'synthetic-race.csv',
  repeat('a', 64),
  'utf_8',
  'race_merge_v1',
  'accepted',
  '2026-08-25T00:00:00Z',
  '2026-08-25T00:01:00Z',
  '2026-08-24T23:00:00Z',
  '2026-08-24T23:30:00Z',
  '2026-08-24T23:30:00Z',
  3,
  3,
  0,
  0
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
) VALUES (
  '59000000-0000-4000-8000-000000000020',
  '59000000-0000-4000-8000-000000000001',
  'race_merge',
  1,
  '59000000-0000-4000-8000-000000000010',
  '2026-08-25T00:01:00Z',
  '2026-08-24T23:30:00Z',
  '2026-08-25T00:02:00Z',
  true
);

INSERT INTO dna.dataset_version_evidence_receipt (
  owner_id,
  dataset_version_id,
  import_batch_id,
  source_type,
  evidence_kind,
  evidence_partition_count,
  evidence_row_count,
  evidence_byte_size,
  sealed_at
) VALUES (
  '59000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000020',
  '59000000-0000-4000-8000-000000000010',
  'race_merge',
  'staged_rows',
  2,
  3,
  300,
  '2026-08-25T00:02:00Z'
);

SELECT set_config(
  'app.owner_id',
  '59000000-0000-4000-8000-000000000001',
  true
);

DO $privileges$
DECLARE
  v_locator_rls boolean;
  v_locator_force_rls boolean;
  v_receipt_rls boolean;
  v_receipt_force_rls boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO v_locator_rls, v_locator_force_rls
  FROM pg_catalog.pg_class
  WHERE oid = 'dna.race_archive_core_locator'::regclass;

  SELECT relrowsecurity, relforcerowsecurity
  INTO v_receipt_rls, v_receipt_force_rls
  FROM pg_catalog.pg_class
  WHERE oid = 'dna.race_archive_core_locator_receipt'::regclass;

  IF NOT v_locator_rls OR NOT v_locator_force_rls
     OR NOT v_receipt_rls OR NOT v_receipt_force_rls THEN
    RAISE EXCEPTION 'Race archive Core locator tables must use forced RLS';
  END IF;

  IF has_table_privilege(
    'dna_app_runtime',
    'dna.race_archive_core_locator',
    'SELECT,INSERT,UPDATE,DELETE'
  ) OR has_table_privilege(
    'dna_app_runtime',
    'dna.race_archive_core_locator_receipt',
    'SELECT,INSERT,UPDATE,DELETE'
  ) THEN
    RAISE EXCEPTION 'runtime must not have direct Race archive Core locator table DML';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.replace_race_archive_core_locators(uuid,uuid,uuid,character,jsonb,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.list_race_archive_core_locators(uuid,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime bounded Race archive Core locator functions are unavailable';
  END IF;
END
$privileges$;

DO $replace$
DECLARE
  v_status text;
  v_locator_count integer;
  v_ready_rows bigint;
  v_partition_references bigint;
BEGIN
  SELECT
    result.status,
    result.core_locator_count,
    result.ready_row_count,
    result.partition_reference_count
  INTO
    v_status,
    v_locator_count,
    v_ready_rows,
    v_partition_references
  FROM dna.replace_race_archive_core_locators(
    '59000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000020',
    '59000000-0000-4000-8000-000000000010',
    repeat('b', 64)::character(64),
    '[
      {
        "source_core_id": "core-1",
        "partition_numbers": [0, 1],
        "ready_row_count": 2,
        "first_source_row_number": 1,
        "last_source_row_number": 3
      },
      {
        "source_core_id": "core-2",
        "partition_numbers": [1],
        "ready_row_count": 1,
        "first_source_row_number": 2,
        "last_source_row_number": 2
      }
    ]'::jsonb,
    '2026-08-25T00:03:00Z'
  ) result;

  IF v_status <> 'sealed'
     OR v_locator_count <> 2
     OR v_ready_rows <> 3
     OR v_partition_references <> 3 THEN
    RAISE EXCEPTION 'Race archive Core locator replacement receipt is invalid';
  END IF;
END
$replace$;

DO $read$
DECLARE
  v_count integer;
  v_partitions integer[];
  v_ready_rows bigint;
BEGIN
  SELECT count(*)::integer, max(partition_numbers), max(ready_row_count)
  INTO v_count, v_partitions, v_ready_rows
  FROM dna.list_race_archive_core_locators(
    '59000000-0000-4000-8000-000000000001',
    'core-1',
    10
  );

  IF v_count <> 1
     OR v_partitions <> ARRAY[0, 1]
     OR v_ready_rows <> 2 THEN
    RAISE EXCEPTION 'bounded Race archive Core locator read is invalid';
  END IF;
END
$read$;

DO $replay$
DECLARE
  v_status text;
BEGIN
  SELECT result.status INTO v_status
  FROM dna.replace_race_archive_core_locators(
    '59000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000020',
    '59000000-0000-4000-8000-000000000010',
    repeat('b', 64)::character(64),
    '[]'::jsonb,
    '2026-08-25T00:04:00Z'
  ) result;

  IF v_status <> 'existing' THEN
    RAISE EXCEPTION 'exact Race archive Core locator replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.replace_race_archive_core_locators(
      '59000000-0000-4000-8000-000000000001',
      '59000000-0000-4000-8000-000000000020',
      '59000000-0000-4000-8000-000000000010',
      repeat('c', 64)::character(64),
      '[]'::jsonb,
      '2026-08-25T00:04:00Z'
    );
    RAISE EXCEPTION 'conflicting Race archive Core locator replay was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'conflicting Race archive Core locator replay was accepted' THEN
        RAISE;
      END IF;
      IF position('replay conflict' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END
$replay$;

DO $bounds$
BEGIN
  BEGIN
    PERFORM * FROM dna.list_race_archive_core_locators(
      '59000000-0000-4000-8000-000000000001',
      'core-1',
      0
    );
    RAISE EXCEPTION 'zero Race archive Core locator read bound was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'zero Race archive Core locator read bound was accepted' THEN
        RAISE;
      END IF;
      IF position('version bound is invalid' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END
$bounds$;

SELECT set_config(
  'app.owner_id',
  '59000000-0000-4000-8000-000000000002',
  true
);

DO $owner_isolation$
BEGIN
  BEGIN
    PERFORM * FROM dna.list_race_archive_core_locators(
      '59000000-0000-4000-8000-000000000001',
      'core-1',
      10
    );
    RAISE EXCEPTION 'cross-owner Race archive Core locator read was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-owner Race archive Core locator read was accepted' THEN
        RAISE;
      END IF;
      IF position('owner-scoped Race archive Core locator read denied' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END
$owner_isolation$;

ROLLBACK;
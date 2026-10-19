BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1450000-0000-4000-8000-000000000001', 'smoke_discovery_publication_owner'),
  ('a1450000-0000-4000-8000-000000000002', 'smoke_discovery_publication_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  schema_version, status, uploaded_at, import_completed_at,
  minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
) VALUES (
  'a1450000-0000-4000-8000-000000000010',
  'a1450000-0000-4000-8000-000000000001',
  'race_merge', 'discovery-smoke.csv', repeat('a', 64), 'smoke-v1',
  'accepted', '2026-10-19T00:00:00Z', '2026-10-19T00:01:00Z',
  '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z',
  '2026-10-18T00:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES (
  'a1450000-0000-4000-8000-000000000020',
  'a1450000-0000-4000-8000-000000000001',
  'race_merge', 1, 'a1450000-0000-4000-8000-000000000010',
  '2026-10-19T00:01:00Z', '2026-10-18T00:00:00Z',
  '2026-10-19T00:02:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at, completed_at,
  affected_record_count
) VALUES (
  'a1450000-0000-4000-8000-000000000030',
  'a1450000-0000-4000-8000-000000000001',
  'a1450000-0000-4000-8000-000000000020',
  'completed', '2026-10-19T00:01:30Z', '2026-10-19T00:03:00Z', 1
);

INSERT INTO dna.discovery_exact_distance_benchmark (
  owner_id, mode, distance, data_current_through, race_entry_count,
  winning_entry_count, top_three_entry_count, winning_p25_milliseconds,
  winning_median_milliseconds, winning_p75_milliseconds,
  top_three_p25_milliseconds, top_three_median_milliseconds,
  top_three_p75_milliseconds, refreshed_at
) VALUES (
  'a1450000-0000-4000-8000-000000000001', 'bike', 1400,
  '2026-10-18T00:00:00Z', 10, 2, 6, 10000, 10100, 10200,
  10300, 10400, 10500, '2026-10-19T00:02:00Z'
);

INSERT INTO dna.race_archive_aggregate_publication_receipt (
  owner_id, refresh_id, target_dataset_version_id,
  race_dataset_version_id, source_version_set_sha256, payload_sha256,
  core_performance_profile_count, validated_event_count,
  core_star_profile_count, discovery_benchmark_count,
  accepted_format_entry_count, payout_format_profile_count,
  materialized_row_count, refreshed_at, published_at
) VALUES (
  'a1450000-0000-4000-8000-000000000001',
  'a1450000-0000-4000-8000-000000000030',
  'a1450000-0000-4000-8000-000000000020',
  'a1450000-0000-4000-8000-000000000020',
  repeat('b', 64), repeat('c', 64), 0, 0, 0, 1, 0, 0, 1,
  '2026-10-19T00:02:00Z', '2026-10-19T00:03:00Z'
);

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime',
      'dna.race_archive_aggregate_publication_receipt', 'SELECT')
    OR has_table_privilege('dna_app_runtime',
      'dna.discovery_exact_distance_benchmark', 'SELECT')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_discovery_benchmark_publication(uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Discovery benchmark publication read privileges are unsafe';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1450000-0000-4000-8000-000000000001';

DO $read$
DECLARE
  v_owner constant uuid := 'a1450000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT count(*)
      FROM dna.read_discovery_benchmark_publication(v_owner)
      WHERE refresh_id = 'a1450000-0000-4000-8000-000000000030'
        AND race_dataset_version_id = 'a1450000-0000-4000-8000-000000000020'
        AND source_version_set_sha256 = repeat('b', 64)
        AND payload_sha256 = repeat('c', 64)
        AND discovery_benchmark_count = 1
        AND refreshed_at = '2026-10-19T00:02:00Z'
        AND published_at = '2026-10-19T00:03:00Z') <> 1
  THEN
    RAISE EXCEPTION 'Discovery benchmark publication identity is invalid';
  END IF;

  BEGIN
    PERFORM dna.read_discovery_benchmark_publication(
      'a1450000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Cross-owner Discovery benchmark publication read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner Discovery benchmark publication read accepted' THEN
      RAISE;
    END IF;
  END;
END
$read$;

RESET ROLE;
ROLLBACK;

BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('87000000-0000-4000-8000-000000000001', 'synthetic_breeding_authority_owner'),
  ('87000000-0000-4000-8000-000000000002', 'synthetic_breeding_authority_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
) VALUES
  (
    '87000000-0000-4000-8000-000000000101',
    '87000000-0000-4000-8000-000000000001',
    'race_merge', 'synthetic-authority-races.json', repeat('7', 64),
    'utf_8', 'dna-open-lab/v1', 'accepted', '2026-09-08T00:00:00Z',
    '2026-09-08T00:30:00Z', '2026-09-08T00:10:00Z',
    '2026-09-08T00:10:00Z', '2026-09-08T00:10:00Z', 1, 1, 0, 0
  ),
  (
    '87000000-0000-4000-8000-000000000102',
    '87000000-0000-4000-8000-000000000001',
    'current_arena', 'synthetic-authority-arena.json', repeat('8', 64),
    'utf_8', 'dna-open-lab/v1', 'accepted', '2026-09-08T00:05:00Z',
    '2026-09-08T00:20:00Z', NULL, NULL, '2026-09-08T00:05:00Z',
    1, 1, 0, 0
  );

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES
  (
    '87000000-0000-4000-8000-000000000201',
    '87000000-0000-4000-8000-000000000001',
    'race_merge', 1, '87000000-0000-4000-8000-000000000101',
    '2026-09-08T00:31:00Z', '2026-09-08T00:10:00Z',
    '2026-09-08T00:32:00Z', true
  ),
  (
    '87000000-0000-4000-8000-000000000202',
    '87000000-0000-4000-8000-000000000001',
    'current_arena', 1, '87000000-0000-4000-8000-000000000102',
    '2026-09-08T00:21:00Z', '2026-09-08T00:05:00Z',
    '2026-09-08T00:22:00Z', true
  );

INSERT INTO dna.pro_league_evidence_generation (
  owner_id, generation_id, race_dataset_version_id, worker_id,
  source_version_set_sha256, evidence_cutoff_at, input_observation_count,
  accepted_entry_count, non_bike_entry_count, missing_format_entry_count,
  unsupported_format_entry_count, unpublished_cell_entry_count,
  unbenchmarked_entry_count, benchmark_count, profile_count,
  payload_sha256, state, published_at
) VALUES (
  '87000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000301',
  '87000000-0000-4000-8000-000000000201',
  'synthetic-authority-worker', repeat('9', 64),
  '2026-09-08T01:00:00Z', 1, 1, 0, 0, 0, 0, 0, 1, 1,
  repeat('a', 64), 'published', '2026-09-08T01:01:00Z'
);
INSERT INTO dna.pro_league_evidence_active (
  owner_id, generation_id, activated_at
) VALUES (
  '87000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000301',
  '2026-09-08T01:01:00Z'
);

DO $privileges$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.pro_league_evidence_generation', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.pro_league_evidence_active', 'SELECT')
     OR NOT has_function_privilege('dna_app_runtime',
       'dna.read_current_pro_league_breeding_publication_authority(uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'Pro League breeding authority runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '87000000-0000-4000-8000-000000000001';
DO $authority$
DECLARE
  v_owner constant uuid := '87000000-0000-4000-8000-000000000001';
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM dna.read_current_pro_league_breeding_publication_authority(v_owner) authority
  WHERE authority.roster_evidence_cutoff_at = '2026-09-08T01:00:00Z'
    AND authority.latest_performance_import_at = '2026-09-08T00:30:00Z'
    AND authority.latest_arena_import_at = '2026-09-08T00:20:00Z';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'current Pro League breeding publication authority is invalid';
  END IF;

  UPDATE dna.dataset_version
  SET aggregate_refreshed_at = NULL
  WHERE owner_id = v_owner AND source_type = 'current_arena' AND is_active;
  IF EXISTS (
    SELECT 1 FROM dna.read_current_pro_league_breeding_publication_authority(v_owner)
  ) THEN
    RAISE EXCEPTION 'incomplete Arena authority was accepted';
  END IF;

  UPDATE dna.dataset_version
  SET aggregate_refreshed_at = '2026-09-08T00:22:00Z', is_active = false
  WHERE owner_id = v_owner AND source_type = 'current_arena';
  SELECT count(*) INTO v_count
  FROM dna.read_current_pro_league_breeding_publication_authority(v_owner) authority
  WHERE authority.latest_arena_import_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'absent Arena authority did not remain explicitly nullable';
  END IF;

  UPDATE dna.dataset_version
  SET is_active = false
  WHERE owner_id = v_owner AND source_type = 'race_merge';
  IF EXISTS (
    SELECT 1 FROM dna.read_current_pro_league_breeding_publication_authority(v_owner)
  ) THEN
    RAISE EXCEPTION 'stale Pro League performance authority was accepted';
  END IF;
END
$authority$;

SET LOCAL app.owner_id = '87000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_current_pro_league_breeding_publication_authority(
      '87000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner Pro League breeding authority was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Pro League breeding authority was readable' THEN
      RAISE;
    END IF;
  END;
END
$owner_guard$;

ROLLBACK;

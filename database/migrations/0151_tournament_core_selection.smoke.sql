BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1510000-0000-4000-8000-000000000001', 'smoke_tournament_selection_owner'),
  ('a1510000-0000-4000-8000-000000000002', 'smoke_tournament_selection_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  schema_version, status, uploaded_at, import_completed_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  'a1510000-0000-4000-8000-000000000010',
  'a1510000-0000-4000-8000-000000000001',
  'core_details', 'tournament-selection-smoke.csv', repeat('a', 64),
  'smoke-v1', 'accepted', '2026-10-27T00:00:00Z',
  '2026-10-27T00:01:00Z', 1, 1, 0, 0
);

INSERT INTO dna.core (
  id, owner_id, source_core_id, display_name, core_class, element,
  f_number, sex, source_import_batch_id
) VALUES (
  'a1510000-0000-4000-8000-000000000020',
  'a1510000-0000-4000-8000-000000000001',
  'core-selection-smoke', 'Tournament Selection Core', 'Genesis', 'Fire',
  1, 'female', 'a1510000-0000-4000-8000-000000000010'
);

INSERT INTO dna.owner_vault_core (
  id, owner_id, core_id, in_my_vault, me_eligible, version,
  created_at, updated_at
) VALUES (
  'a1510000-0000-4000-8000-000000000030',
  'a1510000-0000-4000-8000-000000000001',
  'a1510000-0000-4000-8000-000000000020',
  true, true, 1, '2026-10-27T00:02:00Z', '2026-10-27T00:02:00Z'
);

INSERT INTO dna.tournament_configuration (
  owner_id, tournament_id, tournament_label, bracket_id, split_label,
  mode, eligible_distances_metres, discovery_relevance,
  qualification_metric_label, configuration_version,
  candidate_snapshot_version, updated_at
) VALUES (
  'a1510000-0000-4000-8000-000000000001',
  'tournament-smoke', 'Tournament Smoke', 'split-smoke', 'Smoke Split',
  'bike', ARRAY[1200], 'eligible', 'median_time', 'config-v1',
  'snapshot-v1', '2026-10-27T00:03:00Z'
);

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime',
      'dna.tournament_core_selection', 'SELECT,INSERT,UPDATE,DELETE')
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'dna.tournament_core_selection'::regclass)
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.replace_tournament_core_selection(uuid,text,text,text,text,text[],timestamptz)',
      'EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_tournament_core_selection(uuid,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Tournament Core selection security is unsafe';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1510000-0000-4000-8000-000000000001';

DO $selection$
DECLARE
  v_owner constant uuid := 'a1510000-0000-4000-8000-000000000001';
BEGIN
  PERFORM dna.replace_tournament_core_selection(
    v_owner, 'tournament-smoke', 'split-smoke', 'config-v1', 'snapshot-v1',
    ARRAY['core-selection-smoke'], '2026-10-27T00:04:00Z');
  IF (SELECT core_ids FROM dna.read_tournament_core_selection(
      v_owner, 'tournament-smoke', 'split-smoke'))
      IS DISTINCT FROM ARRAY['core-selection-smoke'] THEN
    RAISE EXCEPTION 'Tournament Core selection did not read back';
  END IF;

  PERFORM dna.replace_tournament_core_selection(
    v_owner, 'tournament-smoke', 'split-smoke', 'config-v1', 'snapshot-v1',
    ARRAY[]::text[], '2026-10-27T00:05:00Z');
  IF cardinality((SELECT core_ids FROM dna.read_tournament_core_selection(
      v_owner, 'tournament-smoke', 'split-smoke'))) <> 0 THEN
    RAISE EXCEPTION 'Tournament Core selection did not clear';
  END IF;

  BEGIN
    PERFORM dna.replace_tournament_core_selection(
      v_owner, 'tournament-smoke', 'split-smoke', 'config-old', 'snapshot-v1',
      ARRAY['core-selection-smoke'], '2026-10-27T00:06:00Z');
    RAISE EXCEPTION 'Stale Tournament Core selection was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Stale Tournament Core selection was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.read_tournament_core_selection(
      'a1510000-0000-4000-8000-000000000002',
      'tournament-smoke', 'split-smoke');
    RAISE EXCEPTION 'Cross-owner Tournament Core selection read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner Tournament Core selection read accepted' THEN RAISE; END IF;
  END;
END
$selection$;

RESET ROLE;
ROLLBACK;

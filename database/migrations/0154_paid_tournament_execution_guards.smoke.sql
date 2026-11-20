BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1540000-0000-4000-8000-000000000001', 'smoke_execution_guard_owner'),
  ('a1540000-0000-4000-8000-000000000002', 'smoke_execution_guard_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  schema_version, status, uploaded_at, import_completed_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  'a1540000-0000-4000-8000-000000000010',
  'a1540000-0000-4000-8000-000000000001', 'core_details',
  'execution-guard-smoke.csv', repeat('a', 64), 'smoke-v1', 'accepted',
  '2026-11-19T00:00:00Z', '2026-11-19T00:01:00Z', 1, 1, 0, 0
);
INSERT INTO dna.core (
  id, owner_id, source_core_id, display_name, core_class, element,
  f_number, sex, source_import_batch_id
) VALUES (
  'a1540000-0000-4000-8000-000000000020',
  'a1540000-0000-4000-8000-000000000001', '10457',
  'Execution Guard Core', 'Genesis', 'Fire', 1, 'female',
  'a1540000-0000-4000-8000-000000000010'
);
INSERT INTO dna.owner_vault_core (
  id, owner_id, core_id, in_my_vault, me_eligible, version,
  created_at, updated_at
) VALUES (
  'a1540000-0000-4000-8000-000000000030',
  'a1540000-0000-4000-8000-000000000001',
  'a1540000-0000-4000-8000-000000000020', true, true, 1,
  '2026-11-19T00:02:00Z', '2026-11-19T00:02:00Z'
);
INSERT INTO dna.tournament_configuration (
  owner_id, tournament_id, tournament_label, bracket_id, split_label,
  mode, eligible_distances_metres, discovery_relevance,
  qualification_metric_label, configuration_version,
  candidate_snapshot_version, updated_at
) VALUES (
  'a1540000-0000-4000-8000-000000000001', 'tournament-smoke',
  'Tournament Smoke', 'segment-smoke', 'Smoke Segment', 'bike', ARRAY[1200],
  'eligible', 'median_time', 'config-v1', 'snapshot-v1',
  '2026-11-19T00:03:00Z'
);
INSERT INTO dna.tournament_core_selection (
  owner_id, tournament_id, bracket_id, configuration_version,
  candidate_snapshot_version, core_ids, updated_at
) VALUES (
  'a1540000-0000-4000-8000-000000000001', 'tournament-smoke',
  'segment-smoke', 'config-v1', 'snapshot-v1', ARRAY['10457'],
  '2026-11-19T00:04:00Z'
);

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime',
      'dna.race_entry_owner_control', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('dna_app_runtime',
      'dna.race_entry_owner_control_event', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('dna_app_runtime',
      'dna.paid_tournament_segment_guard', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('dna_app_runtime',
      'dna.paid_tournament_segment_guard_event', 'SELECT,INSERT,UPDATE,DELETE')
    OR NOT (SELECT bool_and(relrowsecurity AND relforcerowsecurity)
      FROM pg_class WHERE oid IN (
        'dna.race_entry_owner_control'::regclass,
        'dna.race_entry_owner_control_event'::regclass,
        'dna.paid_tournament_segment_guard'::regclass,
        'dna.paid_tournament_segment_guard_event'::regclass))
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.configure_race_entry_owner_control(uuid,uuid,text,text,boolean,boolean,timestamptz,timestamptz)',
      'EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.configure_paid_tournament_segment_guard(uuid,uuid,text,text,text,text,text,text,text,integer,numeric,numeric,numeric,numeric,numeric,timestamptz,timestamptz)',
      'EXECUTE')
  THEN RAISE EXCEPTION 'paid Tournament execution guard security is unsafe'; END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1540000-0000-4000-8000-000000000001';

DO $controls$
DECLARE
  v_owner constant uuid := 'a1540000-0000-4000-8000-000000000001';
  v_control_event constant uuid := 'a1540000-0000-4000-8000-000000000100';
  v_guard_event constant uuid := 'a1540000-0000-4000-8000-000000000200';
BEGIN
  PERFORM * FROM dna.configure_race_entry_owner_control(
    v_owner, v_control_event, NULL, 'control-v1', true, true,
    '2026-11-19T01:00:00Z', '2026-11-19T01:01:00Z');
  PERFORM * FROM dna.configure_race_entry_owner_control(
    v_owner, v_control_event, NULL, 'control-v1', true, true,
    '2026-11-19T01:00:00Z', '2026-11-19T01:01:00Z');
  IF NOT (SELECT globally_paused FROM dna.read_race_entry_owner_control(v_owner))
    OR NOT (SELECT kill_switch_engaged FROM dna.read_race_entry_owner_control(v_owner))
    OR (SELECT live_execution_enabled FROM dna.read_race_entry_owner_control(v_owner))
  THEN RAISE EXCEPTION 'owner pause/kill control did not fail closed'; END IF;

  BEGIN
    PERFORM * FROM dna.configure_race_entry_owner_control(
      v_owner, 'a1540000-0000-4000-8000-000000000101', 'wrong-version',
      'control-v2', false, false, '2026-11-19T01:02:00Z',
      '2026-11-19T01:03:00Z');
    RAISE EXCEPTION 'stale owner control update was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'stale owner control update was accepted' THEN RAISE; END IF;
  END;

  PERFORM * FROM dna.configure_paid_tournament_segment_guard(
    v_owner, v_guard_event, 'tournament-smoke', 'segment-smoke', '10457',
    'config-v1', 'snapshot-v1', NULL, 'guard-v1', 2,
    3.500000000000000000, 10.000000000000000000,
    20.000000000000000000, 30.000000000000000000,
    -5.000000000000000000, '2026-11-19T01:04:00Z',
    '2026-11-19T01:05:00Z');
  PERFORM * FROM dna.configure_paid_tournament_segment_guard(
    v_owner, v_guard_event, 'tournament-smoke', 'segment-smoke', '10457',
    'config-v1', 'snapshot-v1', NULL, 'guard-v1', 2,
    3.500000000000000000, 10.000000000000000000,
    20.000000000000000000, 30.000000000000000000,
    -5.000000000000000000, '2026-11-19T01:04:00Z',
    '2026-11-19T01:05:00Z');
  IF (SELECT asset FROM dna.read_paid_tournament_segment_guards(v_owner, 100))
      IS DISTINCT FROM 'HLX'
    OR (SELECT max_unsettled_entries
      FROM dna.read_paid_tournament_segment_guards(v_owner, 100)) <> 2
    OR (SELECT max_unsettled_exposure_hlx
      FROM dna.read_paid_tournament_segment_guards(v_owner, 100))
      IS DISTINCT FROM 3.500000000000000000
    OR (SELECT realised_stop_loss_hlx
      FROM dna.read_paid_tournament_segment_guards(v_owner, 100))
      IS DISTINCT FROM -5.000000000000000000
    OR (SELECT live_execution_enabled
      FROM dna.read_paid_tournament_segment_guards(v_owner, 100))
  THEN RAISE EXCEPTION 'paid Tournament exact HLX guards did not persist'; END IF;

  BEGIN
    PERFORM * FROM dna.configure_paid_tournament_segment_guard(
      v_owner, 'a1540000-0000-4000-8000-000000000201',
      'tournament-smoke', 'segment-smoke', '10457', 'config-v1', 'snapshot-v1',
      'guard-v1', 'guard-v2', 3, 11, 10, 20, 30, -5,
      '2026-11-19T01:06:00Z', '2026-11-19T01:07:00Z');
    RAISE EXCEPTION 'exposure above segment ceiling was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'exposure above segment ceiling was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.read_paid_tournament_segment_guards(
      'a1540000-0000-4000-8000-000000000002', 100);
    RAISE EXCEPTION 'cross-owner paid Tournament guard read was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-owner paid Tournament guard read was accepted' THEN RAISE; END IF;
  END;
END
$controls$;

RESET ROLE;

DO $audit$
BEGIN
  IF (SELECT count(*) FROM dna.race_entry_owner_control_event
      WHERE owner_id = 'a1540000-0000-4000-8000-000000000001') <> 1
    OR (SELECT count(*) FROM dna.paid_tournament_segment_guard_event
      WHERE owner_id = 'a1540000-0000-4000-8000-000000000001') <> 1
  THEN RAISE EXCEPTION 'execution guard idempotency audit duplicated'; END IF;
END
$audit$;

ROLLBACK;

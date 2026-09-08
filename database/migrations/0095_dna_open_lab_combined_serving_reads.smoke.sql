BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('95000000-0000-4000-8000-000000000001', 'synthetic_combined_serving_owner'),
  ('95000000-0000-4000-8000-000000000002', 'synthetic_combined_serving_other');

INSERT INTO dna.dna_open_lab_finished_race_incremental_cycle (
  owner_id, cycle_id, source_family, previous_completed_cycle_id,
  lower_bound_at, upper_bound_at
) VALUES (
  '95000000-0000-4000-8000-000000000001', repeat('1', 64),
  'races_finished', NULL,
  '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00'
);

INSERT INTO dna.dna_open_lab_finished_race_incremental_publication (
  owner_id, cycle_id, previous_published_cycle_id, attempt_number,
  lower_bound_at, upper_bound_at, receipt_count, document_count,
  manifest_byte_length, receipt_set_sha256, validated_at, published_at
) VALUES (
  '95000000-0000-4000-8000-000000000001', repeat('1', 64), NULL, 1,
  '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00', 1, 10, 100,
  repeat('a', 64), '2026-09-03 00:01:00+00', '2026-09-03 00:02:00+00'
);

INSERT INTO dna.dna_open_lab_sync_generation (
  owner_id, id, observed_at, recorded_at, status, published_at
) VALUES
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000011',
   '2026-09-03 00:00:00+00', '2026-09-03 00:01:00+00', 'published',
   '2026-09-03 00:03:00+00'),
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000012',
   '2026-09-04 00:00:00+00', '2026-09-04 00:01:00+00', 'published',
   '2026-09-04 00:03:00+00');

INSERT INTO dna.dna_open_lab_sync_state (
  owner_id, accepted_generation_id, accepted_observed_at, accepted_at,
  serving_generation_id, sync_status, catch_up_required, last_attempt_at,
  revision
) VALUES (
  '95000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000012', '2026-09-04 00:00:00+00',
  '2026-09-04 00:03:00+00', '95000000-0000-4000-8000-000000000012',
  'current', false, '2026-09-04 00:03:00+00', 2
);

INSERT INTO dna.dna_open_lab_r2_budget_window (
  owner_id, window_id, window_start_at, window_end_at, measured_at,
  baseline_storage_bytes, baseline_class_a_operations,
  baseline_class_b_operations
) VALUES (
  '95000000-0000-4000-8000-000000000001', repeat('c', 64),
  '2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00',
  '2026-09-01 00:00:00+00', 0, 0, 0
);

INSERT INTO dna.dna_open_lab_r2_budget_reservation (
  owner_id, window_id, refresh_cycle_id, request_sha256, status,
  planned_storage_bytes, planned_class_a_operations,
  planned_class_b_operations, reserved_at
) VALUES (
  '95000000-0000-4000-8000-000000000001', repeat('c', 64), repeat('d', 64),
  repeat('e', 64), 'reserved', 1000, 10, 20, '2026-09-03 00:00:00+00'
);

INSERT INTO dna.dna_open_lab_daily_refresh_generation (
  owner_id, refresh_cycle_id, budget_window_id, budget_request_sha256,
  finished_history_cycle_id, current_state_generation_id,
  actual_storage_bytes, actual_class_a_operations, actual_class_b_operations,
  published_at
) VALUES (
  '95000000-0000-4000-8000-000000000001', repeat('d', 64), repeat('c', 64),
  repeat('e', 64), repeat('1', 64),
  '95000000-0000-4000-8000-000000000011', 900, 8, 18,
  '2026-09-03 00:04:00+00'
);

INSERT INTO dna.dna_open_lab_daily_refresh_active (
  owner_id, refresh_cycle_id, activated_at
) VALUES (
  '95000000-0000-4000-8000-000000000001', repeat('d', 64),
  '2026-09-03 00:04:00+00'
);

INSERT INTO dna.dna_open_lab_active_race_snapshot (
  owner_id, generation_id, source_race_id, observed_at,
  raw_evidence_sha256, canonical
) VALUES
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000011', 'combined-race',
   '2026-09-03 00:00:00+00', repeat('1', 64), '{}'::jsonb),
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000012', 'live-race',
   '2026-09-04 00:00:00+00', repeat('2', 64), '{}'::jsonb);

INSERT INTO dna.dna_open_lab_race_fill_snapshot (
  owner_id, generation_id, source_race_id, observed_at,
  raw_evidence_sha256, canonical
) VALUES
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000011', 'combined-race',
   '2026-09-03 00:00:00+00', repeat('3', 64), '{}'::jsonb),
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000012', 'live-race',
   '2026-09-04 00:00:00+00', repeat('4', 64), '{}'::jsonb);

INSERT INTO dna.dna_open_lab_owned_core_snapshot (
  owner_id, generation_id, source_core_id, display_name, core_class,
  element, f_number, sex, observed_at, raw_evidence_sha256
) VALUES
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000011', 101, 'Combined Core',
   'Morphed', 'Metal', 16, 'female', '2026-09-03 00:00:00+00', repeat('5', 64)),
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000012', 102, 'Live Core',
   'Morphed', 'Fire', 17, 'male', '2026-09-04 00:00:00+00', repeat('6', 64));

INSERT INTO dna.dna_open_lab_core_supplemental_snapshot (
  owner_id, generation_id, source_core_id, family, observed_at,
  raw_evidence_sha256, canonical
) VALUES
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000011', 101, 'power',
   '2026-09-03 00:00:00+00', repeat('7', 64), '{}'::jsonb),
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000012', 102, 'power',
   '2026-09-04 00:00:00+00', repeat('8', 64), '{}'::jsonb);

INSERT INTO dna.dna_open_lab_current_state_evidence_index (
  owner_id, generation_id, plan_sha256, indexed_at,
  receipt_count, receipt_index, recorded_at
) VALUES
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000011', repeat('9', 64),
   '2026-09-03 00:00:00+00', 1, '{}'::jsonb, '2026-09-03 00:01:00+00'),
  ('95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000012', repeat('a', 64),
   '2026-09-04 00:00:00+00', 1, '{}'::jsonb, '2026-09-04 00:01:00+00');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime', 'dna.dna_open_lab_daily_refresh_generation', 'SELECT'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_open_lab_daily_refresh_active', 'SELECT'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_combined_serving_sync_state(uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_combined_serving_active_races(uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_combined_serving_race_fills(uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_combined_serving_supplemental_cores(uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_combined_serving_current_state_evidence_index(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'combined serving runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '95000000-0000-4000-8000-000000000001';

DO $combined_authority$
DECLARE
  v_owner constant uuid := '95000000-0000-4000-8000-000000000001';
  v_combined constant uuid := '95000000-0000-4000-8000-000000000011';
  v_state record;
  v_count integer;
BEGIN
  SELECT * INTO STRICT v_state
  FROM dna.read_dna_open_lab_combined_serving_sync_state(v_owner);
  IF v_state.accepted_generation_id <> v_combined
     OR v_state.serving_generation_id <> v_combined
     OR v_state.sync_status <> 'catching_up'
     OR NOT v_state.catch_up_required THEN
    RAISE EXCEPTION 'combined serving state followed the independent live pointer';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_combined_serving_active_races(v_owner)
  WHERE generation_id = v_combined AND source_race_id = 'combined-race';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'combined serving active races were not pinned';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_combined_serving_race_fills(v_owner)
  WHERE generation_id = v_combined AND source_race_id = 'combined-race';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'combined serving race fills were not pinned';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_combined_serving_supplemental_cores(v_owner)
  WHERE generation_id = v_combined AND source_core_id = 101;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'combined serving supplemental Cores were not pinned';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_combined_serving_current_state_evidence_index(v_owner)
  WHERE generation_id = v_combined AND plan_sha256 = repeat('9', 64);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'combined serving evidence index was not pinned';
  END IF;
END
$combined_authority$;

SET LOCAL app.owner_id = '95000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_combined_serving_sync_state(
      '95000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner combined serving state was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner combined serving state was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

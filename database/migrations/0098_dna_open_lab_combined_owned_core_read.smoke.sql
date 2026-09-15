BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('98000000-0000-4000-8000-000000000001', 'synthetic_combined_core_owner'),
  ('98000000-0000-4000-8000-000000000002', 'synthetic_combined_core_other');

INSERT INTO dna.dna_open_lab_finished_race_incremental_cycle (
  owner_id, cycle_id, source_family, previous_completed_cycle_id,
  lower_bound_at, upper_bound_at
) VALUES (
  '98000000-0000-4000-8000-000000000001', repeat('1', 64),
  'races_finished', NULL,
  '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00'
);

INSERT INTO dna.dna_open_lab_finished_race_incremental_publication (
  owner_id, cycle_id, previous_published_cycle_id, attempt_number,
  lower_bound_at, upper_bound_at, receipt_count, document_count,
  manifest_byte_length, receipt_set_sha256, validated_at, published_at
) VALUES (
  '98000000-0000-4000-8000-000000000001', repeat('1', 64), NULL, 1,
  '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00', 1, 10, 100,
  repeat('a', 64), '2026-09-03 00:01:00+00', '2026-09-03 00:02:00+00'
);

INSERT INTO dna.dna_open_lab_sync_generation (
  owner_id, id, observed_at, recorded_at, status, published_at
) VALUES
  ('98000000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000011',
   '2026-09-03 00:00:00+00', '2026-09-03 00:01:00+00', 'published',
   '2026-09-03 00:03:00+00'),
  ('98000000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000012',
   '2026-09-04 00:00:00+00', '2026-09-04 00:01:00+00', 'published',
   '2026-09-04 00:03:00+00');

INSERT INTO dna.dna_open_lab_sync_state (
  owner_id, accepted_generation_id, accepted_observed_at, accepted_at,
  serving_generation_id, sync_status, catch_up_required, last_attempt_at,
  revision
) VALUES (
  '98000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000012', '2026-09-04 00:00:00+00',
  '2026-09-04 00:03:00+00', '98000000-0000-4000-8000-000000000012',
  'current', false, '2026-09-04 00:03:00+00', 2
);

INSERT INTO dna.dna_open_lab_r2_budget_window (
  owner_id, window_id, window_start_at, window_end_at, measured_at,
  baseline_storage_bytes, baseline_class_a_operations,
  baseline_class_b_operations
) VALUES (
  '98000000-0000-4000-8000-000000000001', repeat('c', 64),
  '2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00',
  '2026-09-01 00:00:00+00', 0, 0, 0
);

INSERT INTO dna.dna_open_lab_r2_budget_reservation (
  owner_id, window_id, refresh_cycle_id, request_sha256, status,
  planned_storage_bytes, planned_class_a_operations,
  planned_class_b_operations, reserved_at
) VALUES (
  '98000000-0000-4000-8000-000000000001', repeat('c', 64), repeat('d', 64),
  repeat('e', 64), 'reserved', 1000, 10, 20, '2026-09-03 00:00:00+00'
);

INSERT INTO dna.dna_open_lab_daily_refresh_generation (
  owner_id, refresh_cycle_id, budget_window_id, budget_request_sha256,
  finished_history_cycle_id, current_state_generation_id,
  actual_storage_bytes, actual_class_a_operations, actual_class_b_operations,
  published_at
) VALUES (
  '98000000-0000-4000-8000-000000000001', repeat('d', 64), repeat('c', 64),
  repeat('e', 64), repeat('1', 64),
  '98000000-0000-4000-8000-000000000011', 900, 8, 18,
  '2026-09-03 00:04:00+00'
);

INSERT INTO dna.dna_open_lab_daily_refresh_active (
  owner_id, refresh_cycle_id, activated_at
) VALUES (
  '98000000-0000-4000-8000-000000000001', repeat('d', 64),
  '2026-09-03 00:04:00+00'
);

INSERT INTO dna.dna_open_lab_owned_core_snapshot (
  owner_id, generation_id, source_core_id, display_name, core_class,
  element, f_number, sex, observed_at, raw_evidence_sha256
) VALUES
  ('98000000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000011', 101, 'Combined Core',
   'Morphed', 'Metal', 16, 'female', '2026-09-03 00:00:00+00', repeat('5', 64)),
  ('98000000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000012', 102, 'Live Core',
   'Morphed', 'Fire', 17, 'male', '2026-09-04 00:00:00+00', repeat('6', 64));

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime', 'dna.dna_open_lab_owned_core_snapshot', 'SELECT'
     ) OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_combined_serving_owned_cores(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'combined owned Core runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '98000000-0000-4000-8000-000000000001';

DO $combined_authority$
DECLARE
  v_owner constant uuid := '98000000-0000-4000-8000-000000000001';
  v_combined constant uuid := '98000000-0000-4000-8000-000000000011';
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_combined_serving_owned_cores(v_owner)
  WHERE generation_id = v_combined AND source_core_id = 101
    AND display_name = 'Combined Core';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'combined owned Cores were not pinned';
  END IF;
  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_combined_serving_owned_cores(v_owner)
  WHERE source_core_id = 102;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'independent live owned Core leaked into combined serving';
  END IF;
END
$combined_authority$;

SET LOCAL app.owner_id = '98000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_combined_serving_owned_cores(
      '98000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner combined owned Cores were readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner combined owned Cores were readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('99000000-0000-4000-8000-000000000001', 'synthetic_combined_history_owner'),
  ('99000000-0000-4000-8000-000000000002', 'synthetic_combined_history_other');

INSERT INTO dna.dna_open_lab_finished_race_incremental_cycle (
  owner_id, cycle_id, source_family, previous_completed_cycle_id,
  lower_bound_at, upper_bound_at
) VALUES
  ('99000000-0000-4000-8000-000000000001', repeat('1', 64),
   'races_finished', NULL,
   '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00'),
  ('99000000-0000-4000-8000-000000000001', repeat('2', 64),
   'races_finished', repeat('1', 64),
   '2026-09-03 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('99000000-0000-4000-8000-000000000001', repeat('3', 64),
   'races_finished', repeat('2', 64),
   '2026-09-04 00:00:00+00', '2026-09-05 00:00:00+00');

INSERT INTO dna.dna_open_lab_finished_race_incremental_publication (
  owner_id, cycle_id, previous_published_cycle_id, attempt_number,
  lower_bound_at, upper_bound_at, receipt_count, document_count,
  manifest_byte_length, receipt_set_sha256, validated_at, published_at
) VALUES
  ('99000000-0000-4000-8000-000000000001', repeat('1', 64), NULL, 1,
   '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00', 1, 10, 100,
   repeat('a', 64), '2026-09-03 00:01:00+00', '2026-09-03 00:02:00+00'),
  ('99000000-0000-4000-8000-000000000001', repeat('2', 64), repeat('1', 64), 1,
   '2026-09-03 00:00:00+00', '2026-09-04 00:00:00+00', 1, 11, 101,
   repeat('b', 64), '2026-09-04 00:01:00+00', '2026-09-04 00:02:00+00'),
  ('99000000-0000-4000-8000-000000000001', repeat('3', 64), repeat('2', 64), 1,
   '2026-09-04 00:00:00+00', '2026-09-05 00:00:00+00', 1, 12, 102,
   repeat('c', 64), '2026-09-05 00:01:00+00', '2026-09-05 00:02:00+00');

INSERT INTO dna.dna_open_lab_finished_race_incremental_window_receipt (
  owner_id, cycle_id, first_attempt_number, window_key, content_sha256,
  document_count, manifest_object_key, manifest_body_sha256,
  manifest_byte_length, window_start_at, window_end_at
) VALUES
  ('99000000-0000-4000-8000-000000000001', repeat('1', 64), 1,
   repeat('4', 64), repeat('5', 64), 10, 'private/history/first.json',
   repeat('6', 64), 100, '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00'),
  ('99000000-0000-4000-8000-000000000001', repeat('2', 64), 1,
   repeat('7', 64), repeat('8', 64), 11, 'private/history/second.json',
   repeat('9', 64), 101, '2026-09-03 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('99000000-0000-4000-8000-000000000001', repeat('3', 64), 1,
   repeat('d', 64), repeat('e', 64), 12, 'private/history/newer.json',
   repeat('f', 64), 102, '2026-09-04 00:00:00+00', '2026-09-05 00:00:00+00');

INSERT INTO dna.dna_open_lab_finished_race_incremental_active (
  owner_id, cycle_id, activated_at
) VALUES (
  '99000000-0000-4000-8000-000000000001', repeat('3', 64),
  '2026-09-05 00:02:00+00'
);

INSERT INTO dna.dna_open_lab_sync_generation (
  owner_id, id, observed_at, recorded_at, status, published_at
) VALUES (
  '99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000011',
  '2026-09-04 00:00:00+00', '2026-09-04 00:01:00+00', 'published',
  '2026-09-04 00:03:00+00'
);

INSERT INTO dna.dna_open_lab_r2_budget_window (
  owner_id, window_id, window_start_at, window_end_at, measured_at,
  baseline_storage_bytes, baseline_class_a_operations,
  baseline_class_b_operations
) VALUES (
  '99000000-0000-4000-8000-000000000001', repeat('a', 64),
  '2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00',
  '2026-09-01 00:00:00+00', 0, 0, 0
);

INSERT INTO dna.dna_open_lab_r2_budget_reservation (
  owner_id, window_id, refresh_cycle_id, request_sha256, status,
  planned_storage_bytes, planned_class_a_operations,
  planned_class_b_operations, reserved_at
) VALUES (
  '99000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64),
  repeat('c', 64), 'reserved', 1000, 10, 20, '2026-09-04 00:00:00+00'
);

INSERT INTO dna.dna_open_lab_daily_refresh_generation (
  owner_id, refresh_cycle_id, budget_window_id, budget_request_sha256,
  finished_history_cycle_id, current_state_generation_id,
  actual_storage_bytes, actual_class_a_operations, actual_class_b_operations,
  published_at
) VALUES (
  '99000000-0000-4000-8000-000000000001', repeat('b', 64), repeat('a', 64),
  repeat('c', 64), repeat('2', 64),
  '99000000-0000-4000-8000-000000000011', 900, 8, 18,
  '2026-09-04 00:04:00+00'
);

INSERT INTO dna.dna_open_lab_daily_refresh_active (
  owner_id, refresh_cycle_id, activated_at
) VALUES (
  '99000000-0000-4000-8000-000000000001', repeat('b', 64),
  '2026-09-04 00:04:00+00'
);

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_finished_race_incremental_publication', 'SELECT'
     ) OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_finished_race_incremental_window_receipt', 'SELECT'
     ) OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_combined_serving_finished_history(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'combined finished-history runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '99000000-0000-4000-8000-000000000001';

DO $combined_authority$
DECLARE
  v_owner constant uuid := '99000000-0000-4000-8000-000000000001';
  v_count integer;
  v_document_count bigint;
  v_min_depth integer;
  v_max_depth integer;
BEGIN
  SELECT count(*), sum(window_document_count), min(lineage_depth), max(lineage_depth)
  INTO v_count, v_document_count, v_min_depth, v_max_depth
  FROM dna.read_dna_open_lab_combined_serving_finished_history(v_owner);
  IF v_count <> 2 OR v_document_count <> 21
     OR v_min_depth <> 0 OR v_max_depth <> 1 THEN
    RAISE EXCEPTION 'combined finished-history lineage was incomplete';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_combined_serving_finished_history(v_owner)
  WHERE selected_cycle_id <> repeat('2', 64)
     OR cycle_id = repeat('3', 64)
     OR refresh_cycle_id <> repeat('b', 64)
     OR current_state_generation_id <>
        '99000000-0000-4000-8000-000000000011'::uuid;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'newer independent history leaked into combined serving';
  END IF;
END
$combined_authority$;

SET LOCAL app.owner_id = '99000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_combined_serving_finished_history(
      '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner combined finished history was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner combined finished history was readable' THEN
      RAISE;
    END IF;
  END;
END
$owner_guard$;

ROLLBACK;

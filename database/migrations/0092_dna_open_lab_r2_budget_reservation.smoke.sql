BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('92000000-0000-4000-8000-000000000001', 'synthetic_r2_budget_owner'),
  ('92000000-0000-4000-8000-000000000002', 'synthetic_r2_budget_other');

DO $privileges$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.dna_open_lab_r2_budget_window', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.dna_open_lab_r2_budget_reservation', 'SELECT')
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.open_dna_open_lab_r2_budget_window(uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,bigint,bigint,bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime', 'dna.read_dna_open_lab_r2_budget_window(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'DNA Open Lab R2 budget runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '92000000-0000-4000-8000-000000000001';
DO $reservation_lifecycle$
DECLARE
  v_owner constant uuid := '92000000-0000-4000-8000-000000000001';
  v_old_window constant text := repeat('a', 64);
  v_new_window constant text := repeat('b', 64);
  v_cycle constant text := repeat('c', 64);
  v_request constant text := repeat('d', 64);
  v_now timestamptz := clock_timestamp();
  v_result record;
  v_count integer;
BEGIN
  PERFORM * FROM dna.open_dna_open_lab_r2_budget_window(
    v_owner, v_old_window, v_now - interval '2 days', v_now - interval '1 day',
    v_now - interval '2 days' + interval '1 minute',
    7999999000, 799400, 7998500
  );

  SELECT * INTO v_result FROM dna.reserve_dna_open_lab_r2_budget(
    v_owner, v_old_window, v_cycle, v_request, 500, 500, 1000,
    v_now - interval '2 days' + interval '2 minutes'
  );
  IF NOT v_result.allowed OR v_result.reservation_status <> 'reserved'
     OR v_result.projected_storage_bytes <> 7999999500
     OR v_result.projected_class_a_operations <> 799900
     OR v_result.projected_class_b_operations <> 7999500 THEN
    RAISE EXCEPTION 'R2 budget was not reserved atomically';
  END IF;

  SELECT * INTO v_result FROM dna.reserve_dna_open_lab_r2_budget(
    v_owner, v_old_window, v_cycle, v_request, 500, 500, 1000,
    v_now - interval '2 days' + interval '2 minutes'
  );
  SELECT count(*) INTO v_count FROM dna.dna_open_lab_r2_budget_reservation
  WHERE owner_id = v_owner AND window_id = v_old_window::character(64);
  IF NOT v_result.allowed OR v_count <> 1 THEN
    RAISE EXCEPTION 'R2 budget exact replay was not idempotent';
  END IF;

  SELECT * INTO v_result FROM dna.reserve_dna_open_lab_r2_budget(
    v_owner, v_old_window, repeat('e', 64), repeat('f', 64), 600, 1, 1,
    v_now - interval '2 days' + interval '3 minutes'
  );
  IF v_result.allowed OR v_result.blocker_ids <> ARRAY['storage_budget_exhausted']::text[] THEN
    RAISE EXCEPTION 'R2 storage budget did not fail closed';
  END IF;

  SELECT * INTO v_result FROM dna.reserve_dna_open_lab_r2_budget(
    v_owner, v_old_window, repeat('1', 64), repeat('2', 64), 0, 1001, 2001,
    v_now - interval '2 days' + interval '4 minutes'
  );
  IF v_result.allowed
     OR v_result.blocker_ids <> ARRAY[
       'class_a_refresh_limit_exceeded', 'class_b_refresh_limit_exceeded',
       'class_a_budget_exhausted', 'class_b_budget_exhausted'
     ]::text[] THEN
    RAISE EXCEPTION 'R2 per-refresh and billing budgets did not fail closed';
  END IF;

  BEGIN
    PERFORM * FROM dna.open_dna_open_lab_r2_budget_window(
      v_owner, v_new_window, v_now - interval '1 hour', v_now + interval '27 days',
      v_now, 7999999000, 0, 0
    );
    RAISE EXCEPTION 'R2 budget rollover ignored an unreconciled reservation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'R2 budget rollover ignored an unreconciled reservation' THEN RAISE; END IF;
  END;

  PERFORM * FROM dna.account_dna_open_lab_r2_budget(
    v_owner, v_old_window, v_cycle, v_request, 400, 450, 900,
    v_now - interval '1 day' - interval '1 minute'
  );
  PERFORM * FROM dna.account_dna_open_lab_r2_budget(
    v_owner, v_old_window, v_cycle, v_request, 400, 450, 900,
    v_now - interval '1 day' - interval '1 minute'
  );
  IF (SELECT reserved_storage_bytes FROM dna.dna_open_lab_r2_budget_window
      WHERE owner_id = v_owner AND window_id = v_old_window::character(64)) <> 0
     OR (SELECT accounted_storage_bytes FROM dna.dna_open_lab_r2_budget_window
      WHERE owner_id = v_owner AND window_id = v_old_window::character(64)) <> 400 THEN
    RAISE EXCEPTION 'R2 budget accounting did not release unused reservation';
  END IF;

  PERFORM * FROM dna.open_dna_open_lab_r2_budget_window(
    v_owner, v_new_window, v_now - interval '1 hour', v_now + interval '27 days',
    v_now, 7999999000, 0, 0
  );
  IF (SELECT count(*) FROM dna.read_dna_open_lab_r2_budget_window(v_owner)) <> 1
     OR (SELECT status FROM dna.dna_open_lab_r2_budget_window
      WHERE owner_id = v_owner AND window_id = v_old_window::character(64)) <> 'closed' THEN
    RAISE EXCEPTION 'R2 budget window rollover was not durable';
  END IF;
END
$reservation_lifecycle$;

SET LOCAL app.owner_id = '92000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_r2_budget_window(
      '92000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner R2 budget was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner R2 budget was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

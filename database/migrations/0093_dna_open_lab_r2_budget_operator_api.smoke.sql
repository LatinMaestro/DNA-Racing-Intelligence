BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('93000000-0000-4000-8000-000000000001', 'synthetic_r2_operator_owner'),
  ('93000000-0000-4000-8000-000000000002', 'synthetic_r2_operator_other');

DO $privileges$
BEGIN
  IF has_function_privilege(
       'dna_app_runtime',
       'dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'dna_app_runtime',
       'dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'R2 budget operator API privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '93000000-0000-4000-8000-000000000001';
DO $restart_safe_replay$
DECLARE
  v_owner constant uuid := '93000000-0000-4000-8000-000000000001';
  v_window constant text := repeat('a', 64);
  v_cycle constant text := repeat('b', 64);
  v_request constant text := repeat('c', 64);
  v_now timestamptz := clock_timestamp();
  v_first_reserved_at timestamptz;
  v_first_accounted_at timestamptz;
BEGIN
  PERFORM * FROM dna.open_dna_open_lab_r2_budget_window(
    v_owner, v_window, v_now - interval '1 hour', v_now + interval '27 days',
    v_now, 1000, 100, 200
  );
  PERFORM * FROM dna.reserve_dna_open_lab_r2_budget(
    v_owner, v_window, v_cycle, v_request, 500, 10, 20
  );
  SELECT reserved_at INTO v_first_reserved_at
  FROM dna.dna_open_lab_r2_budget_reservation
  WHERE owner_id = v_owner AND window_id = v_window::character(64)
    AND refresh_cycle_id = v_cycle::character(64);
  PERFORM pg_sleep(0.01);
  PERFORM * FROM dna.reserve_dna_open_lab_r2_budget(
    v_owner, v_window, v_cycle, v_request, 500, 10, 20
  );
  IF (SELECT reserved_at FROM dna.dna_open_lab_r2_budget_reservation
      WHERE owner_id = v_owner AND window_id = v_window::character(64)
        AND refresh_cycle_id = v_cycle::character(64)) <> v_first_reserved_at THEN
    RAISE EXCEPTION 'operator reservation replay changed its original time';
  END IF;

  PERFORM * FROM dna.account_dna_open_lab_r2_budget(
    v_owner, v_window, v_cycle, v_request, 400, 9, 19
  );
  SELECT accounted_at INTO v_first_accounted_at
  FROM dna.dna_open_lab_r2_budget_reservation
  WHERE owner_id = v_owner AND window_id = v_window::character(64)
    AND refresh_cycle_id = v_cycle::character(64);
  PERFORM pg_sleep(0.01);
  PERFORM * FROM dna.account_dna_open_lab_r2_budget(
    v_owner, v_window, v_cycle, v_request, 400, 9, 19
  );
  IF (SELECT accounted_at FROM dna.dna_open_lab_r2_budget_reservation
      WHERE owner_id = v_owner AND window_id = v_window::character(64)
        AND refresh_cycle_id = v_cycle::character(64)) <> v_first_accounted_at
     OR (SELECT accounted_storage_bytes FROM dna.dna_open_lab_r2_budget_window
      WHERE owner_id = v_owner AND window_id = v_window::character(64)) <> 400 THEN
    RAISE EXCEPTION 'operator accounting replay was not exactly idempotent';
  END IF;
END
$restart_safe_replay$;

SET LOCAL app.owner_id = '93000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.reserve_dna_open_lab_r2_budget(
      '93000000-0000-4000-8000-000000000001', repeat('a', 64),
      repeat('d', 64), repeat('e', 64), 0, 0, 0
    );
    RAISE EXCEPTION 'cross-owner R2 operator reservation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner R2 operator reservation was accepted' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('94000000-0000-4000-8000-000000000001', 'synthetic_daily_refresh_owner'),
  ('94000000-0000-4000-8000-000000000002', 'synthetic_daily_refresh_other');

INSERT INTO dna.dna_open_lab_finished_race_incremental_cycle (
  owner_id, cycle_id, source_family, previous_completed_cycle_id,
  lower_bound_at, upper_bound_at
) VALUES
  ('94000000-0000-4000-8000-000000000001', repeat('1', 64),
   'races_finished', NULL, '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00'),
  ('94000000-0000-4000-8000-000000000001', repeat('2', 64),
   'races_finished', repeat('1', 64),
   '2026-09-03 00:00:00+00', '2026-09-04 00:00:00+00');

INSERT INTO dna.dna_open_lab_finished_race_incremental_publication (
  owner_id, cycle_id, previous_published_cycle_id, attempt_number,
  lower_bound_at, upper_bound_at, receipt_count, document_count,
  manifest_byte_length, receipt_set_sha256, validated_at, published_at
) VALUES
  ('94000000-0000-4000-8000-000000000001', repeat('1', 64), NULL, 1,
   '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00', 1, 10, 100,
   repeat('a', 64), '2026-09-03 00:01:00+00', '2026-09-03 00:02:00+00'),
  ('94000000-0000-4000-8000-000000000001', repeat('2', 64), repeat('1', 64), 1,
   '2026-09-03 00:00:00+00', '2026-09-04 00:00:00+00', 1, 12, 120,
   repeat('b', 64), '2026-09-04 00:01:00+00', '2026-09-04 00:02:00+00');

INSERT INTO dna.dna_open_lab_finished_race_incremental_active (
  owner_id, cycle_id, activated_at
) VALUES (
  '94000000-0000-4000-8000-000000000001', repeat('1', 64),
  '2026-09-03 00:02:00+00'
);

INSERT INTO dna.dna_open_lab_sync_generation (
  owner_id, id, observed_at, recorded_at, status, published_at
) VALUES
  ('94000000-0000-4000-8000-000000000001',
   '94000000-0000-4000-8000-000000000011',
   '2026-09-03 00:00:00+00', '2026-09-03 00:01:00+00', 'published',
   '2026-09-03 00:03:00+00'),
  ('94000000-0000-4000-8000-000000000001',
   '94000000-0000-4000-8000-000000000012',
   '2026-09-04 00:00:00+00', '2026-09-04 00:01:00+00', 'published',
   '2026-09-04 00:03:00+00');

INSERT INTO dna.dna_open_lab_sync_state (
  owner_id, accepted_generation_id, accepted_observed_at, accepted_at,
  serving_generation_id, sync_status, catch_up_required, last_attempt_at,
  revision
) VALUES (
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000011', '2026-09-03 00:00:00+00',
  '2026-09-03 00:03:00+00', '94000000-0000-4000-8000-000000000011',
  'current', false, '2026-09-03 00:03:00+00', 1
);

INSERT INTO dna.dna_open_lab_r2_budget_window (
  owner_id, window_id, window_start_at, window_end_at, measured_at,
  baseline_storage_bytes, baseline_class_a_operations,
  baseline_class_b_operations
) VALUES (
  '94000000-0000-4000-8000-000000000001', repeat('c', 64),
  '2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00',
  '2026-09-01 00:00:00+00', 0, 0, 0
);

INSERT INTO dna.dna_open_lab_r2_budget_reservation (
  owner_id, window_id, refresh_cycle_id, request_sha256, status,
  planned_storage_bytes, planned_class_a_operations,
  planned_class_b_operations, reserved_at
) VALUES
  ('94000000-0000-4000-8000-000000000001', repeat('c', 64), repeat('d', 64),
   repeat('e', 64), 'reserved', 1000, 10, 20, '2026-09-03 00:00:00+00'),
  ('94000000-0000-4000-8000-000000000001', repeat('c', 64), repeat('f', 64),
   repeat('0', 64), 'reserved', 1200, 12, 24, '2026-09-04 00:00:00+00'),
  ('94000000-0000-4000-8000-000000000001', repeat('c', 64), repeat('3', 64),
   repeat('4', 64), 'reserved', 1, 1, 1, '2026-09-04 00:00:00+00');

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
       'dna.publish_dna_open_lab_daily_refresh_generation(uuid,text,text,text,text,uuid,bigint,bigint,bigint,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_daily_refresh_generation(uuid,text)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_daily_refresh_last_good(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'daily refresh generation runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '94000000-0000-4000-8000-000000000001';

DO $first_publication$
DECLARE
  v_owner constant uuid := '94000000-0000-4000-8000-000000000001';
  v_first constant text := repeat('d', 64);
  v_second constant text := repeat('f', 64);
  v_result dna.dna_open_lab_daily_refresh_generation%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO v_result FROM dna.publish_dna_open_lab_daily_refresh_generation(
    v_owner, v_first, repeat('c', 64), repeat('e', 64), repeat('1', 64),
    '94000000-0000-4000-8000-000000000011', 900, 8, 18,
    '2026-09-03 00:04:00+00'
  );
  IF v_result.refresh_cycle_id::text <> v_first
     OR v_result.finished_history_cycle_id::text <> repeat('1', 64)
     OR (SELECT refresh_cycle_id::text
         FROM dna.read_dna_open_lab_daily_refresh_last_good(v_owner)) <> v_first THEN
    RAISE EXCEPTION 'daily refresh first generation was not activated';
  END IF;

  SELECT * INTO v_result FROM dna.publish_dna_open_lab_daily_refresh_generation(
    v_owner, v_first, repeat('c', 64), repeat('e', 64), repeat('1', 64),
    '94000000-0000-4000-8000-000000000011', 900, 8, 18,
    '2026-09-03 00:04:00+00'
  );
  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_daily_refresh_generation(v_owner, v_first);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'daily refresh exact replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.publish_dna_open_lab_daily_refresh_generation(
      v_owner, v_first, repeat('c', 64), repeat('e', 64), repeat('1', 64),
      '94000000-0000-4000-8000-000000000011', 901, 8, 18,
      '2026-09-03 00:04:00+00'
    );
    RAISE EXCEPTION 'daily refresh conflicting replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'daily refresh conflicting replay was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.publish_dna_open_lab_daily_refresh_generation(
      v_owner, v_second, repeat('c', 64), repeat('0', 64), repeat('2', 64),
      '94000000-0000-4000-8000-000000000012', 1000, 10, 20,
      '2026-09-04 00:04:00+00'
    );
    RAISE EXCEPTION 'daily refresh exposed sources before both were last-good';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'daily refresh exposed sources before both were last-good' THEN RAISE; END IF;
  END;

END
$first_publication$;

RESET ROLE;
UPDATE dna.dna_open_lab_finished_race_incremental_active
SET cycle_id = repeat('2', 64), activated_at = '2026-09-04 00:02:00+00'
WHERE owner_id = '94000000-0000-4000-8000-000000000001';
UPDATE dna.dna_open_lab_sync_state
SET accepted_generation_id = '94000000-0000-4000-8000-000000000012',
    accepted_observed_at = '2026-09-04 00:00:00+00',
    accepted_at = '2026-09-04 00:03:00+00',
    serving_generation_id = '94000000-0000-4000-8000-000000000012',
    last_attempt_at = '2026-09-04 00:03:00+00', revision = revision + 1
WHERE owner_id = '94000000-0000-4000-8000-000000000001';
SET LOCAL ROLE dna_app_runtime;

DO $successor_publication$
DECLARE
  v_owner constant uuid := '94000000-0000-4000-8000-000000000001';
  v_second constant text := repeat('f', 64);
  v_result dna.dna_open_lab_daily_refresh_generation%ROWTYPE;
BEGIN

  SELECT * INTO v_result FROM dna.publish_dna_open_lab_daily_refresh_generation(
    v_owner, v_second, repeat('c', 64), repeat('0', 64), repeat('2', 64),
    '94000000-0000-4000-8000-000000000012', 1000, 10, 20,
    '2026-09-04 00:04:00+00'
  );
  IF (SELECT refresh_cycle_id::text
      FROM dna.read_dna_open_lab_daily_refresh_last_good(v_owner)) <> v_second THEN
    RAISE EXCEPTION 'daily refresh successor did not atomically replace last-good';
  END IF;

  BEGIN
    PERFORM * FROM dna.publish_dna_open_lab_daily_refresh_generation(
      v_owner, repeat('3', 64), repeat('c', 64), repeat('4', 64), repeat('2', 64),
      '94000000-0000-4000-8000-000000000012', 2, 1, 1,
      '2026-09-04 00:05:00+00'
    );
    RAISE EXCEPTION 'daily refresh accepted actual usage above reservation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'daily refresh accepted actual usage above reservation' THEN RAISE; END IF;
  END;
END
$successor_publication$;

SET LOCAL app.owner_id = '94000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_daily_refresh_last_good(
      '94000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner daily refresh was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner daily refresh was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

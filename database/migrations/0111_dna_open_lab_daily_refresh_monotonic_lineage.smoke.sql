BEGIN;

DO $definition$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.publish_dna_open_lab_daily_refresh_generation(uuid,text,text,text,text,uuid,bigint,bigint,bigint,timestamp with time zone)'::regprocedure
  ) INTO v_definition;

  IF position('WITH RECURSIVE lineage AS' in v_definition) = 0
     OR position('lineage.cycle_id = v_previous.finished_history_cycle_id' in v_definition) = 0 THEN
    RAISE EXCEPTION 'daily refresh publication does not verify finished-history ancestry';
  END IF;

  IF position(
    'v_finished.previous_published_cycle_id <> v_previous.finished_history_cycle_id' in v_definition
  ) > 0 THEN
    RAISE EXCEPTION 'direct-predecessor-only daily refresh guard remains active';
  END IF;
END
$definition$;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('91110000-0000-4000-8000-000000000001', 'synthetic_daily_refresh_lineage_owner');

INSERT INTO dna.dna_open_lab_finished_race_incremental_cycle (
  owner_id, cycle_id, source_family, previous_completed_cycle_id,
  lower_bound_at, upper_bound_at
) VALUES
  ('91110000-0000-4000-8000-000000000001', repeat('1', 64),
   'races_finished', NULL, '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00'),
  ('91110000-0000-4000-8000-000000000001', repeat('2', 64),
   'races_finished', repeat('1', 64),
   '2026-09-03 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('91110000-0000-4000-8000-000000000001', repeat('3', 64),
   'races_finished', repeat('2', 64),
   '2026-09-04 00:00:00+00', '2026-09-05 00:00:00+00');

INSERT INTO dna.dna_open_lab_finished_race_incremental_publication (
  owner_id, cycle_id, previous_published_cycle_id, attempt_number,
  lower_bound_at, upper_bound_at, receipt_count, document_count,
  manifest_byte_length, receipt_set_sha256, validated_at, published_at
) VALUES
  ('91110000-0000-4000-8000-000000000001', repeat('1', 64), NULL, 1,
   '2026-09-02 00:00:00+00', '2026-09-03 00:00:00+00', 1, 10, 100,
   repeat('a', 64), '2026-09-03 00:01:00+00', '2026-09-03 00:02:00+00'),
  ('91110000-0000-4000-8000-000000000001', repeat('2', 64), repeat('1', 64), 1,
   '2026-09-03 00:00:00+00', '2026-09-04 00:00:00+00', 1, 11, 110,
   repeat('b', 64), '2026-09-04 00:01:00+00', '2026-09-04 00:02:00+00'),
  ('91110000-0000-4000-8000-000000000001', repeat('3', 64), repeat('2', 64), 1,
   '2026-09-04 00:00:00+00', '2026-09-05 00:00:00+00', 1, 12, 120,
   repeat('c', 64), '2026-09-05 00:01:00+00', '2026-09-05 00:02:00+00');

INSERT INTO dna.dna_open_lab_finished_race_incremental_active (
  owner_id, cycle_id, activated_at
) VALUES (
  '91110000-0000-4000-8000-000000000001', repeat('1', 64),
  '2026-09-03 00:02:00+00'
);

INSERT INTO dna.dna_open_lab_sync_generation (
  owner_id, id, observed_at, recorded_at, status, published_at
) VALUES
  ('91110000-0000-4000-8000-000000000001',
   '91110000-0000-4000-8000-000000000011',
   '2026-09-03 00:00:00+00', '2026-09-03 00:01:00+00', 'published',
   '2026-09-03 00:03:00+00'),
  ('91110000-0000-4000-8000-000000000001',
   '91110000-0000-4000-8000-000000000013',
   '2026-09-05 00:00:00+00', '2026-09-05 00:01:00+00', 'published',
   '2026-09-05 00:03:00+00');

INSERT INTO dna.dna_open_lab_sync_state (
  owner_id, accepted_generation_id, accepted_observed_at, accepted_at,
  serving_generation_id, sync_status, catch_up_required, last_attempt_at,
  revision
) VALUES (
  '91110000-0000-4000-8000-000000000001',
  '91110000-0000-4000-8000-000000000011', '2026-09-03 00:00:00+00',
  '2026-09-03 00:03:00+00', '91110000-0000-4000-8000-000000000011',
  'current', false, '2026-09-03 00:03:00+00', 1
);

INSERT INTO dna.dna_open_lab_r2_budget_window (
  owner_id, window_id, window_start_at, window_end_at, measured_at,
  baseline_storage_bytes, baseline_class_a_operations,
  baseline_class_b_operations
) VALUES (
  '91110000-0000-4000-8000-000000000001', repeat('4', 64),
  '2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00',
  '2026-09-01 00:00:00+00', 0, 0, 0
);

INSERT INTO dna.dna_open_lab_r2_budget_reservation (
  owner_id, window_id, refresh_cycle_id, request_sha256, status,
  planned_storage_bytes, planned_class_a_operations,
  planned_class_b_operations, reserved_at
) VALUES
  ('91110000-0000-4000-8000-000000000001', repeat('4', 64), repeat('5', 64),
   repeat('6', 64), 'reserved', 1000, 10, 20, '2026-09-03 00:00:00+00'),
  ('91110000-0000-4000-8000-000000000001', repeat('4', 64), repeat('7', 64),
   repeat('8', 64), 'reserved', 1200, 12, 24, '2026-09-05 00:00:00+00');

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91110000-0000-4000-8000-000000000001';

DO $first_daily$
DECLARE
  v_owner constant uuid := '91110000-0000-4000-8000-000000000001';
BEGIN
  PERFORM * FROM dna.publish_dna_open_lab_daily_refresh_generation(
    v_owner, repeat('5', 64), repeat('4', 64), repeat('6', 64), repeat('1', 64),
    '91110000-0000-4000-8000-000000000011', 900, 8, 18,
    '2026-09-03 00:04:00+00'
  );
END
$first_daily$;

RESET ROLE;

UPDATE dna.dna_open_lab_finished_race_incremental_active
SET cycle_id = repeat('3', 64), activated_at = '2026-09-05 00:02:00+00'
WHERE owner_id = '91110000-0000-4000-8000-000000000001';

UPDATE dna.dna_open_lab_sync_state
SET accepted_generation_id = '91110000-0000-4000-8000-000000000013',
    accepted_observed_at = '2026-09-05 00:00:00+00',
    accepted_at = '2026-09-05 00:03:00+00',
    serving_generation_id = '91110000-0000-4000-8000-000000000013',
    last_attempt_at = '2026-09-05 00:03:00+00', revision = revision + 1
WHERE owner_id = '91110000-0000-4000-8000-000000000001';

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91110000-0000-4000-8000-000000000001';

DO $multi_hop_daily$
DECLARE
  v_owner constant uuid := '91110000-0000-4000-8000-000000000001';
  v_result dna.dna_open_lab_daily_refresh_generation%ROWTYPE;
BEGIN
  SELECT * INTO v_result FROM dna.publish_dna_open_lab_daily_refresh_generation(
    v_owner, repeat('7', 64), repeat('4', 64), repeat('8', 64), repeat('3', 64),
    '91110000-0000-4000-8000-000000000013', 1100, 10, 22,
    '2026-09-05 00:04:00+00'
  );

  IF v_result.finished_history_cycle_id::text <> repeat('3', 64)
     OR (SELECT refresh_cycle_id::text
         FROM dna.read_dna_open_lab_daily_refresh_last_good(v_owner)) <> repeat('7', 64) THEN
    RAISE EXCEPTION 'daily refresh did not accept valid multi-hop finished-history ancestry';
  END IF;
END
$multi_hop_daily$;

ROLLBACK;

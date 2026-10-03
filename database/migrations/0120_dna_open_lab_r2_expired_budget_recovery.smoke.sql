BEGIN;

DO $contract$
BEGIN
  IF to_regprocedure(
       'dna.reconcile_expired_dna_open_lab_r2_budget_window(uuid)'
     ) IS NULL
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.reconcile_expired_dna_open_lab_r2_budget_window(uuid)',
       'EXECUTE'
     )
     OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_r2_budget_window',
       'SELECT'
     )
     OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_r2_budget_reservation',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'expired R2 budget recovery runtime contract is invalid';
  END IF;
END
$contract$;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  (
    '91200000-0000-4000-8000-000000000001',
    'synthetic_r2_expired_recovery_owner'
  ),
  (
    '91200000-0000-4000-8000-000000000002',
    'synthetic_r2_current_window_owner'
  ),
  (
    '91200000-0000-4000-8000-000000000003',
    'synthetic_r2_over_cap_owner'
  );

INSERT INTO dna.dna_open_lab_r2_budget_window (
  owner_id,
  window_id,
  window_start_at,
  window_end_at,
  measured_at,
  status,
  baseline_storage_bytes,
  baseline_class_a_operations,
  baseline_class_b_operations,
  accounted_storage_bytes,
  accounted_class_a_operations,
  accounted_class_b_operations,
  reserved_storage_bytes,
  reserved_class_a_operations,
  reserved_class_b_operations,
  revision,
  updated_at
) VALUES
(
  '91200000-0000-4000-8000-000000000001',
  repeat('a', 64)::character(64),
  (
    date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
      - interval '2 months'
  ) AT TIME ZONE 'UTC',
  (
    date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
      - interval '1 month'
  ) AT TIME ZONE 'UTC',
  (
    date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
      - interval '2 months'
      + interval '1 day'
  ) AT TIME ZONE 'UTC',
  'open',
  1000,
  100,
  200,
  400,
  9,
  19,
  500,
  10,
  20,
  7,
  clock_timestamp() - interval '1 month'
),
(
  '91200000-0000-4000-8000-000000000002',
  repeat('b', 64)::character(64),
  date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
  (
    date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
      + interval '1 month'
  ) AT TIME ZONE 'UTC',
  clock_timestamp(),
  'open',
  1000,
  100,
  200,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  clock_timestamp()
),
(
  '91200000-0000-4000-8000-000000000003',
  repeat('d', 64)::character(64),
  (
    date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
      - interval '2 months'
  ) AT TIME ZONE 'UTC',
  (
    date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
      - interval '1 month'
  ) AT TIME ZONE 'UTC',
  (
    date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')
      - interval '2 months'
      + interval '1 day'
  ) AT TIME ZONE 'UTC',
  'open',
  9400000000,
  0,
  0,
  0,
  0,
  0,
  200000000,
  0,
  0,
  1,
  clock_timestamp() - interval '1 month'
);

INSERT INTO dna.dna_open_lab_r2_budget_reservation (
  owner_id,
  window_id,
  refresh_cycle_id,
  request_sha256,
  status,
  planned_storage_bytes,
  planned_class_a_operations,
  planned_class_b_operations,
  reserved_at,
  updated_at
) VALUES
(
  '91200000-0000-4000-8000-000000000001',
  repeat('a', 64)::character(64),
  repeat('1', 64)::character(64),
  repeat('2', 64)::character(64),
  'reserved',
  300,
  6,
  12,
  clock_timestamp() - interval '6 weeks',
  clock_timestamp() - interval '6 weeks'
),
(
  '91200000-0000-4000-8000-000000000001',
  repeat('a', 64)::character(64),
  repeat('3', 64)::character(64),
  repeat('4', 64)::character(64),
  'reserved',
  200,
  4,
  8,
  clock_timestamp() - interval '6 weeks',
  clock_timestamp() - interval '6 weeks'
),
(
  '91200000-0000-4000-8000-000000000003',
  repeat('d', 64)::character(64),
  repeat('5', 64)::character(64),
  repeat('6', 64)::character(64),
  'reserved',
  200000000,
  0,
  0,
  clock_timestamp() - interval '6 weeks',
  clock_timestamp() - interval '6 weeks'
);

\if :{?skip_runtime_role}
\else
SET LOCAL ROLE dna_app_runtime;
\endif
SET LOCAL app.owner_id = '91200000-0000-4000-8000-000000000001';

DO $recover$
DECLARE
  v_receipt record;
BEGIN
  SELECT * INTO STRICT v_receipt
  FROM dna.reconcile_expired_dna_open_lab_r2_budget_window(
    '91200000-0000-4000-8000-000000000001'
  );

  IF v_receipt.recovered IS DISTINCT FROM true
     OR v_receipt.reconciled_reservation_count <> 2
     OR v_receipt.reconciled_storage_bytes <> 500
     OR v_receipt.reconciled_class_a_operations <> 10
     OR v_receipt.reconciled_class_b_operations <> 20
     OR v_receipt.closed_window_revision <> 8 THEN
    RAISE EXCEPTION 'expired R2 budget recovery receipt is invalid';
  END IF;
END
$recover$;

\if :{?skip_runtime_role}
\else
RESET ROLE;
\endif

DO $stored$
DECLARE
  v_window dna.dna_open_lab_r2_budget_window%ROWTYPE;
  v_accounted_count bigint;
BEGIN
  SELECT * INTO STRICT v_window
  FROM dna.dna_open_lab_r2_budget_window stored
  WHERE stored.owner_id = '91200000-0000-4000-8000-000000000001'
    AND stored.window_id = repeat('a', 64)::character(64);

  IF v_window.status <> 'closed'
     OR v_window.reserved_storage_bytes <> 0
     OR v_window.reserved_class_a_operations <> 0
     OR v_window.reserved_class_b_operations <> 0
     OR v_window.accounted_storage_bytes <> 900
     OR v_window.accounted_class_a_operations <> 19
     OR v_window.accounted_class_b_operations <> 39
     OR v_window.revision <> 8 THEN
    RAISE EXCEPTION 'expired R2 budget window was not conservatively closed';
  END IF;

  SELECT count(*) INTO v_accounted_count
  FROM dna.dna_open_lab_r2_budget_reservation reservation
  WHERE reservation.owner_id = '91200000-0000-4000-8000-000000000001'
    AND reservation.window_id = repeat('a', 64)::character(64)
    AND reservation.status = 'accounted'
    AND reservation.actual_storage_bytes = reservation.planned_storage_bytes
    AND reservation.actual_class_a_operations =
      reservation.planned_class_a_operations
    AND reservation.actual_class_b_operations =
      reservation.planned_class_b_operations
    AND reservation.accounted_at IS NOT NULL;

  IF v_accounted_count <> 2 THEN
    RAISE EXCEPTION 'expired R2 reservations were not fully accounted';
  END IF;
END
$stored$;

\if :{?skip_runtime_role}
\else
SET LOCAL ROLE dna_app_runtime;
\endif
SET LOCAL app.owner_id = '91200000-0000-4000-8000-000000000001';

DO $replay$
DECLARE
  v_receipt record;
BEGIN
  SELECT * INTO STRICT v_receipt
  FROM dna.reconcile_expired_dna_open_lab_r2_budget_window(
    '91200000-0000-4000-8000-000000000001'
  );

  IF v_receipt.recovered IS DISTINCT FROM false
     OR v_receipt.reconciled_reservation_count <> 0
     OR v_receipt.reconciled_storage_bytes <> 0
     OR v_receipt.closed_window_end_at IS NOT NULL
     OR v_receipt.closed_window_revision IS NOT NULL THEN
    RAISE EXCEPTION 'expired R2 budget recovery replay is not idempotent';
  END IF;
END
$replay$;

SET LOCAL app.owner_id = '91200000-0000-4000-8000-000000000002';

DO $current_window$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.reconcile_expired_dna_open_lab_r2_budget_window(
      '91200000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'current R2 budget window was incorrectly recovered';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%R2 budget window is not expired%' THEN
      RAISE;
    END IF;
  END;
END
$current_window$;

SET LOCAL app.owner_id = '91200000-0000-4000-8000-000000000003';

DO $over_cap$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.reconcile_expired_dna_open_lab_r2_budget_window(
      '91200000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'over-cap expired R2 budget recovery was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%exceeds zero-cost operating ceiling%' THEN
      RAISE;
    END IF;
  END;
END
$over_cap$;

SET LOCAL app.owner_id = '91200000-0000-4000-8000-000000000001';

DO $isolation$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.reconcile_expired_dna_open_lab_r2_budget_window(
      '91200000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'cross-owner expired R2 budget recovery was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%owner-scoped expired R2 budget recovery denied%' THEN
      RAISE;
    END IF;
  END;
END
$isolation$;

\if :{?skip_runtime_role}
\else
RESET ROLE;
\endif

ROLLBACK;

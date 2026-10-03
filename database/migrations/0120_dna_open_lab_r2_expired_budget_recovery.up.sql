BEGIN;

CREATE FUNCTION dna.reconcile_expired_dna_open_lab_r2_budget_window(
  p_owner_id uuid
)
RETURNS TABLE (
  recovered boolean,
  reconciled_reservation_count bigint,
  reconciled_storage_bytes bigint,
  reconciled_class_a_operations bigint,
  reconciled_class_b_operations bigint,
  closed_window_end_at timestamptz,
  closed_window_revision bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_window dna.dna_open_lab_r2_budget_window%ROWTYPE;
  v_current_window_start timestamptz;
  v_reconciled_at timestamptz;
  v_count bigint;
  v_storage bigint;
  v_class_a bigint;
  v_class_b bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped expired R2 budget recovery denied';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':r2-budget', 0)
  );

  SELECT stored.* INTO v_window
  FROM dna.dna_open_lab_r2_budget_window stored
  WHERE stored.owner_id = p_owner_id
    AND stored.status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      0::bigint,
      0::bigint,
      0::bigint,
      0::bigint,
      NULL::timestamptz,
      NULL::bigint;
    RETURN;
  END IF;

  v_current_window_start :=
    date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_window.window_end_at > v_current_window_start THEN
    RAISE EXCEPTION 'R2 budget window is not expired';
  END IF;

  PERFORM 1
  FROM dna.dna_open_lab_r2_budget_reservation reservation
  WHERE reservation.owner_id = p_owner_id
    AND reservation.window_id = v_window.window_id
    AND reservation.status = 'reserved'
  FOR UPDATE;

  SELECT
    count(*)::bigint,
    COALESCE(sum(reservation.planned_storage_bytes), 0)::bigint,
    COALESCE(sum(reservation.planned_class_a_operations), 0)::bigint,
    COALESCE(sum(reservation.planned_class_b_operations), 0)::bigint
  INTO v_count, v_storage, v_class_a, v_class_b
  FROM dna.dna_open_lab_r2_budget_reservation reservation
  WHERE reservation.owner_id = p_owner_id
    AND reservation.window_id = v_window.window_id
    AND reservation.status = 'reserved';

  IF v_storage <> v_window.reserved_storage_bytes
     OR v_class_a <> v_window.reserved_class_a_operations
     OR v_class_b <> v_window.reserved_class_b_operations THEN
    RAISE EXCEPTION 'expired R2 budget reservation counters are inconsistent';
  END IF;

  IF v_window.baseline_storage_bytes
       + v_window.accounted_storage_bytes
       + v_window.reserved_storage_bytes > 9500000000
     OR v_window.baseline_class_a_operations
       + v_window.accounted_class_a_operations
       + v_window.reserved_class_a_operations > 800000
     OR v_window.baseline_class_b_operations
       + v_window.accounted_class_b_operations
       + v_window.reserved_class_b_operations > 8000000 THEN
    RAISE EXCEPTION 'expired R2 budget recovery exceeds zero-cost operating ceiling';
  END IF;

  v_reconciled_at := clock_timestamp();

  UPDATE dna.dna_open_lab_r2_budget_reservation reservation
  SET
    status = 'accounted',
    actual_storage_bytes = reservation.planned_storage_bytes,
    actual_class_a_operations = reservation.planned_class_a_operations,
    actual_class_b_operations = reservation.planned_class_b_operations,
    accounted_at = v_reconciled_at,
    updated_at = v_reconciled_at
  WHERE reservation.owner_id = p_owner_id
    AND reservation.window_id = v_window.window_id
    AND reservation.status = 'reserved';

  UPDATE dna.dna_open_lab_r2_budget_window stored
  SET
    status = 'closed',
    accounted_storage_bytes =
      stored.accounted_storage_bytes + v_storage,
    accounted_class_a_operations =
      stored.accounted_class_a_operations + v_class_a,
    accounted_class_b_operations =
      stored.accounted_class_b_operations + v_class_b,
    reserved_storage_bytes = 0,
    reserved_class_a_operations = 0,
    reserved_class_b_operations = 0,
    revision = stored.revision + 1,
    updated_at = v_reconciled_at
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = v_window.window_id;

  RETURN QUERY SELECT
    (v_count > 0),
    v_count,
    v_storage,
    v_class_a,
    v_class_b,
    v_window.window_end_at,
    v_window.revision + 1;
END
$function$;

REVOKE ALL ON FUNCTION
  dna.reconcile_expired_dna_open_lab_r2_budget_window(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.reconcile_expired_dna_open_lab_r2_budget_window(uuid)
TO dna_app_runtime;

COMMIT;

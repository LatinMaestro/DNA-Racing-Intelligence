BEGIN;

CREATE FUNCTION dna.reserve_dna_open_lab_r2_budget(
  p_owner_id uuid,
  p_window_id text,
  p_refresh_cycle_id text,
  p_request_sha256 text,
  p_planned_storage_bytes bigint,
  p_planned_class_a_operations bigint,
  p_planned_class_b_operations bigint
)
RETURNS TABLE (
  allowed boolean,
  blocker_ids text[],
  projected_storage_bytes bigint,
  projected_class_a_operations bigint,
  projected_class_b_operations bigint,
  reservation_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_reserved_at timestamptz;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped R2 budget reservation denied';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':r2-budget', 0));
  SELECT stored.reserved_at INTO v_reserved_at
  FROM dna.dna_open_lab_r2_budget_reservation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64)
    AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64);
  v_reserved_at := COALESCE(v_reserved_at, clock_timestamp());
  RETURN QUERY SELECT result.* FROM dna.reserve_dna_open_lab_r2_budget(
    p_owner_id, p_window_id, p_refresh_cycle_id, p_request_sha256,
    p_planned_storage_bytes, p_planned_class_a_operations,
    p_planned_class_b_operations, v_reserved_at
  ) result;
END
$function$;

CREATE FUNCTION dna.account_dna_open_lab_r2_budget(
  p_owner_id uuid,
  p_window_id text,
  p_refresh_cycle_id text,
  p_request_sha256 text,
  p_actual_storage_bytes bigint,
  p_actual_class_a_operations bigint,
  p_actual_class_b_operations bigint
)
RETURNS SETOF dna.dna_open_lab_r2_budget_reservation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_accounted_at timestamptz;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped R2 budget accounting denied';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':r2-budget', 0));
  SELECT stored.accounted_at INTO v_accounted_at
  FROM dna.dna_open_lab_r2_budget_reservation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64)
    AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64);
  v_accounted_at := COALESCE(v_accounted_at, clock_timestamp());
  RETURN QUERY SELECT result.* FROM dna.account_dna_open_lab_r2_budget(
    p_owner_id, p_window_id, p_refresh_cycle_id, p_request_sha256,
    p_actual_storage_bytes, p_actual_class_a_operations,
    p_actual_class_b_operations, v_accounted_at
  ) result;
END
$function$;

REVOKE ALL ON FUNCTION dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamptz) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamptz) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint) TO dna_app_runtime;

COMMIT;

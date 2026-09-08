BEGIN;

CREATE TABLE dna.dna_open_lab_r2_budget_window (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  window_id character(64) NOT NULL CHECK (window_id ~ '^[a-f0-9]{64}$'),
  window_start_at timestamptz NOT NULL,
  window_end_at timestamptz NOT NULL,
  measured_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  baseline_storage_bytes bigint NOT NULL CHECK (baseline_storage_bytes >= 0),
  baseline_class_a_operations bigint NOT NULL CHECK (baseline_class_a_operations >= 0),
  baseline_class_b_operations bigint NOT NULL CHECK (baseline_class_b_operations >= 0),
  accounted_storage_bytes bigint NOT NULL DEFAULT 0 CHECK (accounted_storage_bytes >= 0),
  accounted_class_a_operations bigint NOT NULL DEFAULT 0 CHECK (accounted_class_a_operations >= 0),
  accounted_class_b_operations bigint NOT NULL DEFAULT 0 CHECK (accounted_class_b_operations >= 0),
  reserved_storage_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_storage_bytes >= 0),
  reserved_class_a_operations bigint NOT NULL DEFAULT 0 CHECK (reserved_class_a_operations >= 0),
  reserved_class_b_operations bigint NOT NULL DEFAULT 0 CHECK (reserved_class_b_operations >= 0),
  last_blocked_at timestamptz,
  last_blocker_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, window_id),
  UNIQUE (owner_id, window_start_at, window_end_at),
  CHECK (window_start_at < window_end_at),
  CHECK (measured_at >= window_start_at AND measured_at <= window_end_at),
  CHECK (last_blocker_ids <@ ARRAY[
    'class_a_refresh_limit_exceeded', 'class_b_refresh_limit_exceeded',
    'storage_budget_exhausted', 'class_a_budget_exhausted',
    'class_b_budget_exhausted'
  ]::text[])
);

CREATE UNIQUE INDEX dna_open_lab_r2_budget_one_open_window_per_owner
  ON dna.dna_open_lab_r2_budget_window (owner_id) WHERE status = 'open';

CREATE TABLE dna.dna_open_lab_r2_budget_reservation (
  owner_id uuid NOT NULL,
  window_id character(64) NOT NULL,
  refresh_cycle_id character(64) NOT NULL CHECK (refresh_cycle_id ~ '^[a-f0-9]{64}$'),
  request_sha256 character(64) NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'accounted')),
  planned_storage_bytes bigint NOT NULL CHECK (planned_storage_bytes >= 0),
  planned_class_a_operations bigint NOT NULL CHECK (planned_class_a_operations BETWEEN 0 AND 1000),
  planned_class_b_operations bigint NOT NULL CHECK (planned_class_b_operations BETWEEN 0 AND 2000),
  actual_storage_bytes bigint CHECK (actual_storage_bytes >= 0),
  actual_class_a_operations bigint CHECK (actual_class_a_operations >= 0),
  actual_class_b_operations bigint CHECK (actual_class_b_operations >= 0),
  reserved_at timestamptz NOT NULL,
  accounted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, window_id, refresh_cycle_id),
  FOREIGN KEY (owner_id, window_id)
    REFERENCES dna.dna_open_lab_r2_budget_window(owner_id, window_id)
    ON DELETE RESTRICT,
  CHECK (
    (status = 'reserved' AND actual_storage_bytes IS NULL
      AND actual_class_a_operations IS NULL
      AND actual_class_b_operations IS NULL AND accounted_at IS NULL)
    OR
    (status = 'accounted' AND actual_storage_bytes IS NOT NULL
      AND actual_class_a_operations IS NOT NULL
      AND actual_class_b_operations IS NOT NULL AND accounted_at IS NOT NULL)
  ),
  CHECK (actual_storage_bytes IS NULL OR actual_storage_bytes <= planned_storage_bytes),
  CHECK (actual_class_a_operations IS NULL OR actual_class_a_operations <= planned_class_a_operations),
  CHECK (actual_class_b_operations IS NULL OR actual_class_b_operations <= planned_class_b_operations)
);

ALTER TABLE dna.dna_open_lab_r2_budget_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_r2_budget_window FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_r2_budget_window
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_r2_budget_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_r2_budget_reservation FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_r2_budget_reservation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.open_dna_open_lab_r2_budget_window(
  p_owner_id uuid,
  p_window_id text,
  p_window_start_at timestamptz,
  p_window_end_at timestamptz,
  p_measured_at timestamptz,
  p_baseline_storage_bytes bigint,
  p_baseline_class_a_operations bigint,
  p_baseline_class_b_operations bigint
)
RETURNS SETOF dna.dna_open_lab_r2_budget_window
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_open_lab_r2_budget_window%ROWTYPE;
  v_open dna.dna_open_lab_r2_budget_window%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped R2 budget window write denied';
  END IF;
  IF p_window_id IS NULL OR p_window_id !~ '^[a-f0-9]{64}$'
     OR p_window_start_at IS NULL OR p_window_end_at IS NULL
     OR p_measured_at IS NULL OR p_window_start_at >= p_window_end_at
     OR p_measured_at < p_window_start_at OR p_measured_at > p_window_end_at
     OR p_measured_at > clock_timestamp() + interval '5 minutes'
     OR p_baseline_storage_bytes IS NULL OR p_baseline_storage_bytes < 0
     OR p_baseline_class_a_operations IS NULL OR p_baseline_class_a_operations < 0
     OR p_baseline_class_b_operations IS NULL OR p_baseline_class_b_operations < 0 THEN
    RAISE EXCEPTION 'R2 budget window input is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':r2-budget', 0));
  SELECT stored.* INTO v_existing
  FROM dna.dna_open_lab_r2_budget_window stored
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.window_start_at <> p_window_start_at
       OR v_existing.window_end_at <> p_window_end_at
       OR v_existing.measured_at <> p_measured_at
       OR v_existing.baseline_storage_bytes <> p_baseline_storage_bytes
       OR v_existing.baseline_class_a_operations <> p_baseline_class_a_operations
       OR v_existing.baseline_class_b_operations <> p_baseline_class_b_operations THEN
      RAISE EXCEPTION 'R2 budget window replay conflict';
    END IF;
    RETURN QUERY SELECT stored.* FROM dna.dna_open_lab_r2_budget_window stored
      WHERE stored.owner_id = p_owner_id
        AND stored.window_id = p_window_id::character(64);
    RETURN;
  END IF;

  SELECT stored.* INTO v_open
  FROM dna.dna_open_lab_r2_budget_window stored
  WHERE stored.owner_id = p_owner_id AND stored.status = 'open'
  FOR UPDATE;
  IF FOUND THEN
    IF v_open.window_end_at > p_window_start_at THEN
      RAISE EXCEPTION 'R2 budget windows overlap';
    END IF;
    IF EXISTS (
      SELECT 1 FROM dna.dna_open_lab_r2_budget_reservation reservation
      WHERE reservation.owner_id = p_owner_id
        AND reservation.window_id = v_open.window_id
        AND reservation.status = 'reserved'
    ) THEN
      RAISE EXCEPTION 'R2 budget window has unreconciled reservations';
    END IF;
    UPDATE dna.dna_open_lab_r2_budget_window stored SET
      status = 'closed', revision = stored.revision + 1,
      updated_at = p_measured_at
    WHERE stored.owner_id = p_owner_id AND stored.window_id = v_open.window_id;
  END IF;

  INSERT INTO dna.dna_open_lab_r2_budget_window (
    owner_id, window_id, window_start_at, window_end_at, measured_at,
    baseline_storage_bytes, baseline_class_a_operations,
    baseline_class_b_operations, updated_at
  ) VALUES (
    p_owner_id, p_window_id::character(64), p_window_start_at, p_window_end_at,
    p_measured_at, p_baseline_storage_bytes, p_baseline_class_a_operations,
    p_baseline_class_b_operations, p_measured_at
  );
  RETURN QUERY SELECT stored.* FROM dna.dna_open_lab_r2_budget_window stored
    WHERE stored.owner_id = p_owner_id
      AND stored.window_id = p_window_id::character(64);
END
$function$;

CREATE FUNCTION dna.reserve_dna_open_lab_r2_budget(
  p_owner_id uuid,
  p_window_id text,
  p_refresh_cycle_id text,
  p_request_sha256 text,
  p_planned_storage_bytes bigint,
  p_planned_class_a_operations bigint,
  p_planned_class_b_operations bigint,
  p_reserved_at timestamptz
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
  v_window dna.dna_open_lab_r2_budget_window%ROWTYPE;
  v_existing dna.dna_open_lab_r2_budget_reservation%ROWTYPE;
  v_blockers text[] := ARRAY[]::text[];
  v_projected_storage bigint;
  v_projected_a bigint;
  v_projected_b bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped R2 budget reservation denied';
  END IF;
  IF p_window_id IS NULL OR p_window_id !~ '^[a-f0-9]{64}$'
     OR p_refresh_cycle_id IS NULL OR p_refresh_cycle_id !~ '^[a-f0-9]{64}$'
     OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[a-f0-9]{64}$'
     OR p_planned_storage_bytes IS NULL OR p_planned_storage_bytes < 0
     OR p_planned_class_a_operations IS NULL OR p_planned_class_a_operations < 0
     OR p_planned_class_b_operations IS NULL OR p_planned_class_b_operations < 0
     OR p_reserved_at IS NULL OR p_reserved_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'R2 budget reservation input is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':r2-budget', 0));
  SELECT stored.* INTO v_window
  FROM dna.dna_open_lab_r2_budget_window stored
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64)
  FOR UPDATE;
  IF NOT FOUND OR v_window.status <> 'open'
     OR p_reserved_at < v_window.window_start_at
     OR p_reserved_at > v_window.window_end_at THEN
    RAISE EXCEPTION 'R2 budget window is unavailable';
  END IF;

  SELECT stored.* INTO v_existing
  FROM dna.dna_open_lab_r2_budget_reservation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64)
    AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_sha256::text <> p_request_sha256
       OR v_existing.planned_storage_bytes <> p_planned_storage_bytes
       OR v_existing.planned_class_a_operations <> p_planned_class_a_operations
       OR v_existing.planned_class_b_operations <> p_planned_class_b_operations
       OR v_existing.reserved_at <> p_reserved_at THEN
      RAISE EXCEPTION 'R2 budget reservation replay conflict';
    END IF;
    RETURN QUERY SELECT true, ARRAY[]::text[],
      v_window.baseline_storage_bytes + v_window.accounted_storage_bytes
        + v_window.reserved_storage_bytes,
      v_window.baseline_class_a_operations + v_window.accounted_class_a_operations
        + v_window.reserved_class_a_operations,
      v_window.baseline_class_b_operations + v_window.accounted_class_b_operations
        + v_window.reserved_class_b_operations,
      v_existing.status;
    RETURN;
  END IF;

  v_projected_storage := v_window.baseline_storage_bytes
    + v_window.accounted_storage_bytes + v_window.reserved_storage_bytes
    + p_planned_storage_bytes;
  v_projected_a := v_window.baseline_class_a_operations
    + v_window.accounted_class_a_operations + v_window.reserved_class_a_operations
    + p_planned_class_a_operations;
  v_projected_b := v_window.baseline_class_b_operations
    + v_window.accounted_class_b_operations + v_window.reserved_class_b_operations
    + p_planned_class_b_operations;
  IF p_planned_class_a_operations > 1000 THEN
    v_blockers := array_append(v_blockers, 'class_a_refresh_limit_exceeded');
  END IF;
  IF p_planned_class_b_operations > 2000 THEN
    v_blockers := array_append(v_blockers, 'class_b_refresh_limit_exceeded');
  END IF;
  IF v_projected_storage > 8000000000 THEN
    v_blockers := array_append(v_blockers, 'storage_budget_exhausted');
  END IF;
  IF v_projected_a > 800000 THEN
    v_blockers := array_append(v_blockers, 'class_a_budget_exhausted');
  END IF;
  IF v_projected_b > 8000000 THEN
    v_blockers := array_append(v_blockers, 'class_b_budget_exhausted');
  END IF;

  IF cardinality(v_blockers) > 0 THEN
    UPDATE dna.dna_open_lab_r2_budget_window stored SET
      last_blocked_at = p_reserved_at, last_blocker_ids = v_blockers,
      revision = stored.revision + 1, updated_at = p_reserved_at
    WHERE stored.owner_id = p_owner_id
      AND stored.window_id = p_window_id::character(64);
    RETURN QUERY SELECT false, v_blockers, v_projected_storage,
      v_projected_a, v_projected_b, NULL::text;
    RETURN;
  END IF;

  INSERT INTO dna.dna_open_lab_r2_budget_reservation (
    owner_id, window_id, refresh_cycle_id, request_sha256,
    planned_storage_bytes, planned_class_a_operations,
    planned_class_b_operations, reserved_at, updated_at
  ) VALUES (
    p_owner_id, p_window_id::character(64),
    p_refresh_cycle_id::character(64), p_request_sha256::character(64),
    p_planned_storage_bytes, p_planned_class_a_operations,
    p_planned_class_b_operations, p_reserved_at, p_reserved_at
  );
  UPDATE dna.dna_open_lab_r2_budget_window stored SET
    reserved_storage_bytes = stored.reserved_storage_bytes + p_planned_storage_bytes,
    reserved_class_a_operations = stored.reserved_class_a_operations
      + p_planned_class_a_operations,
    reserved_class_b_operations = stored.reserved_class_b_operations
      + p_planned_class_b_operations,
    last_blocked_at = NULL, last_blocker_ids = ARRAY[]::text[],
    revision = stored.revision + 1, updated_at = p_reserved_at
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64);
  RETURN QUERY SELECT true, ARRAY[]::text[], v_projected_storage,
    v_projected_a, v_projected_b, 'reserved'::text;
END
$function$;

CREATE FUNCTION dna.account_dna_open_lab_r2_budget(
  p_owner_id uuid,
  p_window_id text,
  p_refresh_cycle_id text,
  p_request_sha256 text,
  p_actual_storage_bytes bigint,
  p_actual_class_a_operations bigint,
  p_actual_class_b_operations bigint,
  p_accounted_at timestamptz
)
RETURNS SETOF dna.dna_open_lab_r2_budget_reservation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_reservation dna.dna_open_lab_r2_budget_reservation%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped R2 budget accounting denied';
  END IF;
  IF p_window_id IS NULL OR p_window_id !~ '^[a-f0-9]{64}$'
     OR p_refresh_cycle_id IS NULL OR p_refresh_cycle_id !~ '^[a-f0-9]{64}$'
     OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[a-f0-9]{64}$'
     OR p_actual_storage_bytes IS NULL OR p_actual_storage_bytes < 0
     OR p_actual_class_a_operations IS NULL OR p_actual_class_a_operations < 0
     OR p_actual_class_b_operations IS NULL OR p_actual_class_b_operations < 0
     OR p_accounted_at IS NULL OR p_accounted_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'R2 budget accounting input is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':r2-budget', 0));
  PERFORM 1 FROM dna.dna_open_lab_r2_budget_window stored
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64) FOR UPDATE;
  SELECT stored.* INTO v_reservation
  FROM dna.dna_open_lab_r2_budget_reservation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64)
    AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64)
  FOR UPDATE;
  IF NOT FOUND OR v_reservation.request_sha256::text <> p_request_sha256 THEN
    RAISE EXCEPTION 'R2 budget reservation is unavailable';
  END IF;
  IF p_accounted_at < v_reservation.reserved_at
     OR p_actual_storage_bytes > v_reservation.planned_storage_bytes
     OR p_actual_class_a_operations > v_reservation.planned_class_a_operations
     OR p_actual_class_b_operations > v_reservation.planned_class_b_operations THEN
    RAISE EXCEPTION 'R2 budget actual usage exceeds reservation';
  END IF;
  IF v_reservation.status = 'accounted' THEN
    IF v_reservation.actual_storage_bytes <> p_actual_storage_bytes
       OR v_reservation.actual_class_a_operations <> p_actual_class_a_operations
       OR v_reservation.actual_class_b_operations <> p_actual_class_b_operations
       OR v_reservation.accounted_at <> p_accounted_at THEN
      RAISE EXCEPTION 'R2 budget accounting replay conflict';
    END IF;
    RETURN QUERY SELECT stored.* FROM dna.dna_open_lab_r2_budget_reservation stored
      WHERE stored.owner_id = p_owner_id
        AND stored.window_id = p_window_id::character(64)
        AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64);
    RETURN;
  END IF;

  UPDATE dna.dna_open_lab_r2_budget_reservation stored SET
    status = 'accounted', actual_storage_bytes = p_actual_storage_bytes,
    actual_class_a_operations = p_actual_class_a_operations,
    actual_class_b_operations = p_actual_class_b_operations,
    accounted_at = p_accounted_at, updated_at = p_accounted_at
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64)
    AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64);
  UPDATE dna.dna_open_lab_r2_budget_window stored SET
    reserved_storage_bytes = stored.reserved_storage_bytes
      - v_reservation.planned_storage_bytes,
    reserved_class_a_operations = stored.reserved_class_a_operations
      - v_reservation.planned_class_a_operations,
    reserved_class_b_operations = stored.reserved_class_b_operations
      - v_reservation.planned_class_b_operations,
    accounted_storage_bytes = stored.accounted_storage_bytes
      + p_actual_storage_bytes,
    accounted_class_a_operations = stored.accounted_class_a_operations
      + p_actual_class_a_operations,
    accounted_class_b_operations = stored.accounted_class_b_operations
      + p_actual_class_b_operations,
    revision = stored.revision + 1, updated_at = p_accounted_at
  WHERE stored.owner_id = p_owner_id
    AND stored.window_id = p_window_id::character(64);
  RETURN QUERY SELECT stored.* FROM dna.dna_open_lab_r2_budget_reservation stored
    WHERE stored.owner_id = p_owner_id
      AND stored.window_id = p_window_id::character(64)
      AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64);
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_r2_budget_window(p_owner_id uuid)
RETURNS SETOF dna.dna_open_lab_r2_budget_window
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped R2 budget read denied';
  END IF;
  RETURN QUERY SELECT stored.* FROM dna.dna_open_lab_r2_budget_window stored
    WHERE stored.owner_id = p_owner_id AND stored.status = 'open';
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_r2_budget_window FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_r2_budget_window FROM dna_app_runtime;
REVOKE ALL ON TABLE dna.dna_open_lab_r2_budget_reservation FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_r2_budget_reservation FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.open_dna_open_lab_r2_budget_window(uuid,text,timestamptz,timestamptz,timestamptz,bigint,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_r2_budget_window(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.open_dna_open_lab_r2_budget_window(uuid,text,timestamptz,timestamptz,timestamptz,bigint,bigint,bigint) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamptz) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamptz) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_r2_budget_window(uuid) TO dna_app_runtime;

COMMIT;

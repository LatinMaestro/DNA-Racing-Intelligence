BEGIN;

CREATE TABLE dna.dna_open_lab_daily_refresh_generation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  refresh_cycle_id character(64) NOT NULL CHECK (
    refresh_cycle_id ~ '^[a-f0-9]{64}$'
  ),
  budget_window_id character(64) NOT NULL CHECK (
    budget_window_id ~ '^[a-f0-9]{64}$'
  ),
  budget_request_sha256 character(64) NOT NULL CHECK (
    budget_request_sha256 ~ '^[a-f0-9]{64}$'
  ),
  finished_history_cycle_id character(64) NOT NULL CHECK (
    finished_history_cycle_id ~ '^[a-f0-9]{64}$'
  ),
  current_state_generation_id uuid NOT NULL,
  actual_storage_bytes bigint NOT NULL CHECK (actual_storage_bytes >= 0),
  actual_class_a_operations bigint NOT NULL CHECK (actual_class_a_operations >= 0),
  actual_class_b_operations bigint NOT NULL CHECK (actual_class_b_operations >= 0),
  published_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, refresh_cycle_id),
  UNIQUE (owner_id, finished_history_cycle_id),
  UNIQUE (owner_id, current_state_generation_id),
  FOREIGN KEY (owner_id, budget_window_id, refresh_cycle_id)
    REFERENCES dna.dna_open_lab_r2_budget_reservation(
      owner_id, window_id, refresh_cycle_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, finished_history_cycle_id)
    REFERENCES dna.dna_open_lab_finished_race_incremental_publication(
      owner_id, cycle_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, current_state_generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE dna.dna_open_lab_daily_refresh_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  refresh_cycle_id character(64) NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, refresh_cycle_id)
    REFERENCES dna.dna_open_lab_daily_refresh_generation(owner_id, refresh_cycle_id)
    ON DELETE RESTRICT
);

ALTER TABLE dna.dna_open_lab_daily_refresh_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_daily_refresh_generation FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_daily_refresh_generation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_daily_refresh_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_daily_refresh_active FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_daily_refresh_active
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.publish_dna_open_lab_daily_refresh_generation(
  p_owner_id uuid,
  p_refresh_cycle_id text,
  p_budget_window_id text,
  p_budget_request_sha256 text,
  p_finished_history_cycle_id text,
  p_current_state_generation_id uuid,
  p_actual_storage_bytes bigint,
  p_actual_class_a_operations bigint,
  p_actual_class_b_operations bigint,
  p_published_at timestamptz
)
RETURNS SETOF dna.dna_open_lab_daily_refresh_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_open_lab_daily_refresh_generation%ROWTYPE;
  v_active dna.dna_open_lab_daily_refresh_active%ROWTYPE;
  v_previous dna.dna_open_lab_daily_refresh_generation%ROWTYPE;
  v_reservation dna.dna_open_lab_r2_budget_reservation%ROWTYPE;
  v_finished dna.dna_open_lab_finished_race_incremental_publication%ROWTYPE;
  v_current dna.dna_open_lab_sync_generation%ROWTYPE;
  v_finished_active character(64);
  v_current_active uuid;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped daily refresh publication denied';
  END IF;
  IF p_refresh_cycle_id IS NULL OR p_refresh_cycle_id !~ '^[a-f0-9]{64}$'
     OR p_budget_window_id IS NULL OR p_budget_window_id !~ '^[a-f0-9]{64}$'
     OR p_budget_request_sha256 IS NULL OR p_budget_request_sha256 !~ '^[a-f0-9]{64}$'
     OR p_finished_history_cycle_id IS NULL
     OR p_finished_history_cycle_id !~ '^[a-f0-9]{64}$'
     OR p_current_state_generation_id IS NULL
     OR p_actual_storage_bytes IS NULL OR p_actual_storage_bytes < 0
     OR p_actual_class_a_operations IS NULL OR p_actual_class_a_operations < 0
     OR p_actual_class_b_operations IS NULL OR p_actual_class_b_operations < 0
     OR p_published_at IS NULL
     OR p_published_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'daily refresh publication request is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':daily-refresh-publication', 0
  ));

  SELECT stored.* INTO v_existing
  FROM dna.dna_open_lab_daily_refresh_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.budget_window_id::text <> p_budget_window_id
       OR v_existing.budget_request_sha256::text <> p_budget_request_sha256
       OR v_existing.finished_history_cycle_id::text <> p_finished_history_cycle_id
       OR v_existing.current_state_generation_id <> p_current_state_generation_id
       OR v_existing.actual_storage_bytes <> p_actual_storage_bytes
       OR v_existing.actual_class_a_operations <> p_actual_class_a_operations
       OR v_existing.actual_class_b_operations <> p_actual_class_b_operations
       OR v_existing.published_at <> p_published_at THEN
      RAISE EXCEPTION 'daily refresh publication replay conflicts';
    END IF;
    RETURN NEXT v_existing;
    RETURN;
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM dna.dna_open_lab_r2_budget_reservation reservation
  WHERE reservation.owner_id = p_owner_id
    AND reservation.window_id = p_budget_window_id::character(64)
    AND reservation.refresh_cycle_id = p_refresh_cycle_id::character(64)
  FOR UPDATE;
  IF v_reservation.refresh_cycle_id IS NULL
     OR v_reservation.request_sha256::text <> p_budget_request_sha256
     OR p_actual_storage_bytes > v_reservation.planned_storage_bytes
     OR p_actual_class_a_operations > v_reservation.planned_class_a_operations
     OR p_actual_class_b_operations > v_reservation.planned_class_b_operations
     OR (v_reservation.status = 'accounted' AND (
       v_reservation.actual_storage_bytes <> p_actual_storage_bytes
       OR v_reservation.actual_class_a_operations <> p_actual_class_a_operations
       OR v_reservation.actual_class_b_operations <> p_actual_class_b_operations
     )) THEN
    RAISE EXCEPTION 'daily refresh budget authority is unavailable or drifted';
  END IF;

  SELECT publication.* INTO v_finished
  FROM dna.dna_open_lab_finished_race_incremental_publication publication
  WHERE publication.owner_id = p_owner_id
    AND publication.cycle_id = p_finished_history_cycle_id::character(64)
  FOR UPDATE;
  SELECT active.cycle_id INTO v_finished_active
  FROM dna.dna_open_lab_finished_race_incremental_active active
  WHERE active.owner_id = p_owner_id
  FOR UPDATE;
  IF v_finished.cycle_id IS NULL OR v_finished_active IS NULL
     OR v_finished_active <> v_finished.cycle_id
     OR p_published_at < v_finished.published_at THEN
    RAISE EXCEPTION 'daily refresh finished-history authority is not last-good';
  END IF;

  SELECT generation.* INTO v_current
  FROM dna.dna_open_lab_sync_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.id = p_current_state_generation_id
  FOR UPDATE;
  SELECT state.serving_generation_id INTO v_current_active
  FROM dna.dna_open_lab_sync_state state
  WHERE state.owner_id = p_owner_id
  FOR UPDATE;
  IF v_current.id IS NULL OR v_current.status <> 'published'
     OR v_current.published_at IS NULL OR v_current_active IS NULL
     OR v_current_active <> v_current.id
     OR p_published_at < v_current.published_at THEN
    RAISE EXCEPTION 'daily refresh current-state authority is not last-good';
  END IF;

  SELECT active.* INTO v_active
  FROM dna.dna_open_lab_daily_refresh_active active
  WHERE active.owner_id = p_owner_id
  FOR UPDATE;
  IF FOUND THEN
    SELECT stored.* INTO v_previous
    FROM dna.dna_open_lab_daily_refresh_generation stored
    WHERE stored.owner_id = p_owner_id
      AND stored.refresh_cycle_id = v_active.refresh_cycle_id
    FOR UPDATE;
    IF v_finished.previous_published_cycle_id IS NULL
       OR v_finished.previous_published_cycle_id <> v_previous.finished_history_cycle_id
       OR v_current.observed_at < (
         SELECT prior.observed_at
         FROM dna.dna_open_lab_sync_generation prior
         WHERE prior.owner_id = p_owner_id
           AND prior.id = v_previous.current_state_generation_id
       )
       OR p_published_at < v_previous.published_at THEN
      RAISE EXCEPTION 'daily refresh publication does not advance last-good monotonically';
    END IF;
  END IF;

  INSERT INTO dna.dna_open_lab_daily_refresh_generation (
    owner_id, refresh_cycle_id, budget_window_id, budget_request_sha256,
    finished_history_cycle_id, current_state_generation_id,
    actual_storage_bytes, actual_class_a_operations,
    actual_class_b_operations, published_at
  ) VALUES (
    p_owner_id, p_refresh_cycle_id::character(64),
    p_budget_window_id::character(64),
    p_budget_request_sha256::character(64),
    p_finished_history_cycle_id::character(64), p_current_state_generation_id,
    p_actual_storage_bytes, p_actual_class_a_operations,
    p_actual_class_b_operations, p_published_at
  ) RETURNING * INTO v_existing;

  INSERT INTO dna.dna_open_lab_daily_refresh_active (
    owner_id, refresh_cycle_id, activated_at
  ) VALUES (p_owner_id, p_refresh_cycle_id::character(64), p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    refresh_cycle_id = EXCLUDED.refresh_cycle_id,
    activated_at = EXCLUDED.activated_at;

  RETURN NEXT v_existing;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_daily_refresh_generation(
  p_owner_id uuid,
  p_refresh_cycle_id text
)
RETURNS SETOF dna.dna_open_lab_daily_refresh_generation
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped daily refresh generation read denied';
  END IF;
  IF p_refresh_cycle_id IS NULL OR p_refresh_cycle_id !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'daily refresh generation read key is invalid';
  END IF;
  RETURN QUERY
  SELECT stored.*
  FROM dna.dna_open_lab_daily_refresh_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.refresh_cycle_id = p_refresh_cycle_id::character(64);
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_daily_refresh_last_good(p_owner_id uuid)
RETURNS SETOF dna.dna_open_lab_daily_refresh_generation
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped daily refresh last-good read denied';
  END IF;
  RETURN QUERY
  SELECT stored.*
  FROM dna.dna_open_lab_daily_refresh_active active
  JOIN dna.dna_open_lab_daily_refresh_generation stored
    ON stored.owner_id = active.owner_id
   AND stored.refresh_cycle_id = active.refresh_cycle_id
  WHERE active.owner_id = p_owner_id;
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_open_lab_daily_refresh_generation,
  dna.dna_open_lab_daily_refresh_active
FROM PUBLIC;
REVOKE ALL ON TABLE
  dna.dna_open_lab_daily_refresh_generation,
  dna.dna_open_lab_daily_refresh_active
FROM dna_app_runtime;
REVOKE ALL ON FUNCTION
  dna.publish_dna_open_lab_daily_refresh_generation(
    uuid,text,text,text,text,uuid,bigint,bigint,bigint,timestamptz
  ),
  dna.read_dna_open_lab_daily_refresh_generation(uuid,text),
  dna.read_dna_open_lab_daily_refresh_last_good(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  dna.publish_dna_open_lab_daily_refresh_generation(
    uuid,text,text,text,text,uuid,bigint,bigint,bigint,timestamptz
  ),
  dna.read_dna_open_lab_daily_refresh_generation(uuid,text),
  dna.read_dna_open_lab_daily_refresh_last_good(uuid)
TO dna_app_runtime;

COMMIT;

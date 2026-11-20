BEGIN;

CREATE TABLE dna.race_entry_owner_control (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  control_version text NOT NULL,
  globally_paused boolean NOT NULL DEFAULT true,
  kill_switch_engaged boolean NOT NULL DEFAULT true,
  live_execution_enabled boolean NOT NULL DEFAULT false
    CHECK (NOT live_execution_enabled),
  owner_confirmed_at timestamptz NOT NULL CHECK (isfinite(owner_confirmed_at)),
  updated_at timestamptz NOT NULL CHECK (isfinite(updated_at))
);

ALTER TABLE dna.race_entry_owner_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_entry_owner_control FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_entry_owner_control
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE TABLE dna.race_entry_owner_control_event (
  event_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  previous_control_version text,
  control_version text NOT NULL,
  globally_paused boolean NOT NULL,
  kill_switch_engaged boolean NOT NULL,
  live_execution_enabled boolean NOT NULL CHECK (NOT live_execution_enabled),
  owner_confirmed_at timestamptz NOT NULL CHECK (isfinite(owner_confirmed_at)),
  occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
  UNIQUE (owner_id, control_version)
);

ALTER TABLE dna.race_entry_owner_control_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_entry_owner_control_event FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_entry_owner_control_event
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE TABLE dna.paid_tournament_segment_guard (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  bracket_id text NOT NULL,
  core_id text NOT NULL,
  configuration_version text NOT NULL,
  candidate_snapshot_version text NOT NULL,
  guard_version text NOT NULL,
  asset text NOT NULL DEFAULT 'HLX' CHECK (asset = 'HLX'),
  max_unsettled_entries integer NOT NULL
    CHECK (max_unsettled_entries BETWEEN 0 AND 100),
  max_unsettled_exposure_hlx numeric(38, 18) NOT NULL
    CHECK (max_unsettled_exposure_hlx >= 0),
  segment_spend_ceiling_hlx numeric(38, 18) NOT NULL
    CHECK (segment_spend_ceiling_hlx >= 0),
  tournament_spend_ceiling_hlx numeric(38, 18) NOT NULL
    CHECK (tournament_spend_ceiling_hlx >= segment_spend_ceiling_hlx),
  global_session_spend_ceiling_hlx numeric(38, 18) NOT NULL
    CHECK (global_session_spend_ceiling_hlx >= tournament_spend_ceiling_hlx),
  realised_stop_loss_hlx numeric(38, 18) NOT NULL
    CHECK (realised_stop_loss_hlx <= 0),
  live_execution_enabled boolean NOT NULL DEFAULT false
    CHECK (NOT live_execution_enabled),
  owner_confirmed_at timestamptz NOT NULL CHECK (isfinite(owner_confirmed_at)),
  updated_at timestamptz NOT NULL CHECK (isfinite(updated_at)),
  PRIMARY KEY (owner_id, tournament_id, bracket_id, core_id),
  FOREIGN KEY (owner_id, tournament_id, bracket_id)
    REFERENCES dna.tournament_core_selection(owner_id, tournament_id, bracket_id)
    ON DELETE CASCADE,
  CHECK (max_unsettled_exposure_hlx <= segment_spend_ceiling_hlx)
);

ALTER TABLE dna.paid_tournament_segment_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.paid_tournament_segment_guard FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.paid_tournament_segment_guard
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE TABLE dna.paid_tournament_segment_guard_event (
  event_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  bracket_id text NOT NULL,
  core_id text NOT NULL,
  configuration_version text NOT NULL,
  candidate_snapshot_version text NOT NULL,
  previous_guard_version text,
  guard_version text NOT NULL,
  asset text NOT NULL CHECK (asset = 'HLX'),
  max_unsettled_entries integer NOT NULL,
  max_unsettled_exposure_hlx numeric(38, 18) NOT NULL,
  segment_spend_ceiling_hlx numeric(38, 18) NOT NULL,
  tournament_spend_ceiling_hlx numeric(38, 18) NOT NULL,
  global_session_spend_ceiling_hlx numeric(38, 18) NOT NULL,
  realised_stop_loss_hlx numeric(38, 18) NOT NULL,
  live_execution_enabled boolean NOT NULL CHECK (NOT live_execution_enabled),
  owner_confirmed_at timestamptz NOT NULL CHECK (isfinite(owner_confirmed_at)),
  occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
  UNIQUE (owner_id, tournament_id, bracket_id, core_id, guard_version)
);

ALTER TABLE dna.paid_tournament_segment_guard_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.paid_tournament_segment_guard_event FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.paid_tournament_segment_guard_event
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.configure_race_entry_owner_control(
  p_owner_id uuid,
  p_event_id uuid,
  p_previous_control_version text,
  p_control_version text,
  p_globally_paused boolean,
  p_kill_switch_engaged boolean,
  p_owner_confirmed_at timestamptz,
  p_occurred_at timestamptz
)
RETURNS SETOF dna.race_entry_owner_control_event
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_current dna.race_entry_owner_control%ROWTYPE;
  v_event dna.race_entry_owner_control_event%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN RAISE EXCEPTION 'owner-scoped race-entry control write denied'; END IF;
  IF p_event_id IS NULL OR p_control_version IS NULL
    OR btrim(p_control_version) = '' OR octet_length(p_control_version) > 256
    OR p_control_version ~ '[[:cntrl:]]'
    OR (p_previous_control_version IS NOT NULL AND (
      btrim(p_previous_control_version) = ''
      OR octet_length(p_previous_control_version) > 256
      OR p_previous_control_version ~ '[[:cntrl:]]'))
    OR p_control_version IS NOT DISTINCT FROM p_previous_control_version
    OR p_globally_paused IS NULL OR p_kill_switch_engaged IS NULL
    OR p_owner_confirmed_at IS NULL OR NOT isfinite(p_owner_confirmed_at)
    OR p_occurred_at IS NULL OR NOT isfinite(p_occurred_at)
    OR p_owner_confirmed_at > p_occurred_at
    OR p_occurred_at - p_owner_confirmed_at > interval '15 minutes'
    OR p_occurred_at > clock_timestamp()
  THEN RAISE EXCEPTION 'race-entry owner control is invalid'; END IF;

  SELECT event.* INTO v_event
  FROM dna.race_entry_owner_control_event event
  WHERE event.event_id = p_event_id;
  IF FOUND THEN
    IF v_event.owner_id IS DISTINCT FROM p_owner_id
      OR v_event.previous_control_version IS DISTINCT FROM p_previous_control_version
      OR v_event.control_version IS DISTINCT FROM p_control_version
      OR v_event.globally_paused IS DISTINCT FROM p_globally_paused
      OR v_event.kill_switch_engaged IS DISTINCT FROM p_kill_switch_engaged
      OR v_event.owner_confirmed_at IS DISTINCT FROM p_owner_confirmed_at
      OR v_event.occurred_at IS DISTINCT FROM p_occurred_at
    THEN RAISE EXCEPTION 'race-entry owner control idempotency conflict'; END IF;
    RETURN NEXT v_event;
    RETURN;
  END IF;

  SELECT control.* INTO v_current
  FROM dna.race_entry_owner_control control
  WHERE control.owner_id = p_owner_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_current.control_version IS DISTINCT FROM p_previous_control_version
    THEN RAISE EXCEPTION 'race-entry owner control version changed'; END IF;
  ELSIF p_previous_control_version IS NOT NULL THEN
    RAISE EXCEPTION 'race-entry owner control version changed';
  END IF;

  INSERT INTO dna.race_entry_owner_control (
    owner_id, control_version, globally_paused, kill_switch_engaged,
    live_execution_enabled, owner_confirmed_at, updated_at
  ) VALUES (
    p_owner_id, p_control_version, p_globally_paused, p_kill_switch_engaged,
    false, p_owner_confirmed_at, p_occurred_at
  ) ON CONFLICT (owner_id) DO UPDATE SET
    control_version = EXCLUDED.control_version,
    globally_paused = EXCLUDED.globally_paused,
    kill_switch_engaged = EXCLUDED.kill_switch_engaged,
    live_execution_enabled = false,
    owner_confirmed_at = EXCLUDED.owner_confirmed_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO dna.race_entry_owner_control_event (
    event_id, owner_id, previous_control_version, control_version,
    globally_paused, kill_switch_engaged, live_execution_enabled,
    owner_confirmed_at, occurred_at
  ) VALUES (
    p_event_id, p_owner_id, p_previous_control_version, p_control_version,
    p_globally_paused, p_kill_switch_engaged, false,
    p_owner_confirmed_at, p_occurred_at
  ) RETURNING * INTO v_event;
  RETURN NEXT v_event;
END
$function$;

CREATE FUNCTION dna.configure_paid_tournament_segment_guard(
  p_owner_id uuid,
  p_event_id uuid,
  p_tournament_id text,
  p_bracket_id text,
  p_core_id text,
  p_configuration_version text,
  p_candidate_snapshot_version text,
  p_previous_guard_version text,
  p_guard_version text,
  p_max_unsettled_entries integer,
  p_max_unsettled_exposure_hlx numeric,
  p_segment_spend_ceiling_hlx numeric,
  p_tournament_spend_ceiling_hlx numeric,
  p_global_session_spend_ceiling_hlx numeric,
  p_realised_stop_loss_hlx numeric,
  p_owner_confirmed_at timestamptz,
  p_occurred_at timestamptz
)
RETURNS SETOF dna.paid_tournament_segment_guard_event
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_selection dna.tournament_core_selection%ROWTYPE;
  v_current dna.paid_tournament_segment_guard%ROWTYPE;
  v_event dna.paid_tournament_segment_guard_event%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN RAISE EXCEPTION 'owner-scoped paid Tournament guard write denied'; END IF;
  IF p_event_id IS NULL
    OR p_tournament_id IS NULL OR btrim(p_tournament_id) = ''
    OR p_bracket_id IS NULL OR btrim(p_bracket_id) = ''
    OR p_core_id IS NULL OR btrim(p_core_id) = ''
    OR p_configuration_version IS NULL OR btrim(p_configuration_version) = ''
    OR p_candidate_snapshot_version IS NULL
    OR btrim(p_candidate_snapshot_version) = ''
    OR p_guard_version IS NULL OR btrim(p_guard_version) = ''
    OR p_guard_version IS NOT DISTINCT FROM p_previous_guard_version
    OR greatest(octet_length(p_tournament_id), octet_length(p_bracket_id),
      octet_length(p_configuration_version),
      octet_length(p_candidate_snapshot_version), octet_length(p_guard_version),
      coalesce(octet_length(p_previous_guard_version), 0)) > 256
    OR octet_length(p_core_id) > 128
    OR concat_ws('', p_tournament_id, p_bracket_id, p_core_id,
      p_configuration_version, p_candidate_snapshot_version, p_guard_version,
      p_previous_guard_version) ~ '[[:cntrl:]]'
    OR p_max_unsettled_entries IS NULL
    OR p_max_unsettled_entries < 0 OR p_max_unsettled_entries > 100
    OR p_max_unsettled_exposure_hlx IS NULL
    OR p_segment_spend_ceiling_hlx IS NULL
    OR p_tournament_spend_ceiling_hlx IS NULL
    OR p_global_session_spend_ceiling_hlx IS NULL
    OR p_realised_stop_loss_hlx IS NULL
    OR p_max_unsettled_exposure_hlx < 0
    OR p_segment_spend_ceiling_hlx < p_max_unsettled_exposure_hlx
    OR p_tournament_spend_ceiling_hlx < p_segment_spend_ceiling_hlx
    OR p_global_session_spend_ceiling_hlx < p_tournament_spend_ceiling_hlx
    OR p_realised_stop_loss_hlx > 0
    OR p_owner_confirmed_at IS NULL OR NOT isfinite(p_owner_confirmed_at)
    OR p_occurred_at IS NULL OR NOT isfinite(p_occurred_at)
    OR p_owner_confirmed_at > p_occurred_at
    OR p_occurred_at - p_owner_confirmed_at > interval '15 minutes'
    OR p_occurred_at > clock_timestamp()
  THEN RAISE EXCEPTION 'paid Tournament segment guard is invalid'; END IF;

  SELECT event.* INTO v_event
  FROM dna.paid_tournament_segment_guard_event event
  WHERE event.event_id = p_event_id;
  IF FOUND THEN
    IF v_event.owner_id IS DISTINCT FROM p_owner_id
      OR v_event.tournament_id IS DISTINCT FROM p_tournament_id
      OR v_event.bracket_id IS DISTINCT FROM p_bracket_id
      OR v_event.core_id IS DISTINCT FROM p_core_id
      OR v_event.configuration_version IS DISTINCT FROM p_configuration_version
      OR v_event.candidate_snapshot_version IS DISTINCT FROM p_candidate_snapshot_version
      OR v_event.previous_guard_version IS DISTINCT FROM p_previous_guard_version
      OR v_event.guard_version IS DISTINCT FROM p_guard_version
      OR v_event.max_unsettled_entries IS DISTINCT FROM p_max_unsettled_entries
      OR v_event.max_unsettled_exposure_hlx IS DISTINCT FROM p_max_unsettled_exposure_hlx
      OR v_event.segment_spend_ceiling_hlx IS DISTINCT FROM p_segment_spend_ceiling_hlx
      OR v_event.tournament_spend_ceiling_hlx IS DISTINCT FROM p_tournament_spend_ceiling_hlx
      OR v_event.global_session_spend_ceiling_hlx IS DISTINCT FROM p_global_session_spend_ceiling_hlx
      OR v_event.realised_stop_loss_hlx IS DISTINCT FROM p_realised_stop_loss_hlx
      OR v_event.owner_confirmed_at IS DISTINCT FROM p_owner_confirmed_at
      OR v_event.occurred_at IS DISTINCT FROM p_occurred_at
    THEN RAISE EXCEPTION 'paid Tournament guard idempotency conflict'; END IF;
    RETURN NEXT v_event;
    RETURN;
  END IF;

  SELECT selection.* INTO v_selection
  FROM dna.tournament_core_selection selection
  WHERE selection.owner_id = p_owner_id
    AND selection.tournament_id = p_tournament_id
    AND selection.bracket_id = p_bracket_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_selection.configuration_version IS DISTINCT FROM p_configuration_version
    OR v_selection.candidate_snapshot_version IS DISTINCT FROM p_candidate_snapshot_version
    OR NOT (p_core_id = ANY(v_selection.core_ids))
  THEN RAISE EXCEPTION 'paid Tournament guard selection authority changed'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.owner_vault_core vault
    JOIN dna.core core ON core.owner_id = vault.owner_id AND core.id = vault.core_id
    WHERE vault.owner_id = p_owner_id AND vault.in_my_vault
      AND core.source_core_id = p_core_id
  ) THEN RAISE EXCEPTION 'paid Tournament guard Core is not currently owned'; END IF;

  SELECT guard.* INTO v_current
  FROM dna.paid_tournament_segment_guard guard
  WHERE guard.owner_id = p_owner_id
    AND guard.tournament_id = p_tournament_id
    AND guard.bracket_id = p_bracket_id
    AND guard.core_id = p_core_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_current.guard_version IS DISTINCT FROM p_previous_guard_version
    THEN RAISE EXCEPTION 'paid Tournament guard version changed'; END IF;
  ELSIF p_previous_guard_version IS NOT NULL THEN
    RAISE EXCEPTION 'paid Tournament guard version changed';
  END IF;

  INSERT INTO dna.paid_tournament_segment_guard (
    owner_id, tournament_id, bracket_id, core_id, configuration_version,
    candidate_snapshot_version, guard_version, asset, max_unsettled_entries,
    max_unsettled_exposure_hlx, segment_spend_ceiling_hlx,
    tournament_spend_ceiling_hlx, global_session_spend_ceiling_hlx,
    realised_stop_loss_hlx, live_execution_enabled, owner_confirmed_at, updated_at
  ) VALUES (
    p_owner_id, p_tournament_id, p_bracket_id, p_core_id,
    p_configuration_version, p_candidate_snapshot_version, p_guard_version,
    'HLX', p_max_unsettled_entries, p_max_unsettled_exposure_hlx,
    p_segment_spend_ceiling_hlx, p_tournament_spend_ceiling_hlx,
    p_global_session_spend_ceiling_hlx, p_realised_stop_loss_hlx,
    false, p_owner_confirmed_at, p_occurred_at
  ) ON CONFLICT (owner_id, tournament_id, bracket_id, core_id) DO UPDATE SET
    configuration_version = EXCLUDED.configuration_version,
    candidate_snapshot_version = EXCLUDED.candidate_snapshot_version,
    guard_version = EXCLUDED.guard_version,
    asset = 'HLX',
    max_unsettled_entries = EXCLUDED.max_unsettled_entries,
    max_unsettled_exposure_hlx = EXCLUDED.max_unsettled_exposure_hlx,
    segment_spend_ceiling_hlx = EXCLUDED.segment_spend_ceiling_hlx,
    tournament_spend_ceiling_hlx = EXCLUDED.tournament_spend_ceiling_hlx,
    global_session_spend_ceiling_hlx = EXCLUDED.global_session_spend_ceiling_hlx,
    realised_stop_loss_hlx = EXCLUDED.realised_stop_loss_hlx,
    live_execution_enabled = false,
    owner_confirmed_at = EXCLUDED.owner_confirmed_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO dna.paid_tournament_segment_guard_event (
    event_id, owner_id, tournament_id, bracket_id, core_id,
    configuration_version, candidate_snapshot_version, previous_guard_version,
    guard_version, asset, max_unsettled_entries, max_unsettled_exposure_hlx,
    segment_spend_ceiling_hlx, tournament_spend_ceiling_hlx,
    global_session_spend_ceiling_hlx, realised_stop_loss_hlx,
    live_execution_enabled, owner_confirmed_at, occurred_at
  ) VALUES (
    p_event_id, p_owner_id, p_tournament_id, p_bracket_id, p_core_id,
    p_configuration_version, p_candidate_snapshot_version,
    p_previous_guard_version, p_guard_version, 'HLX', p_max_unsettled_entries,
    p_max_unsettled_exposure_hlx, p_segment_spend_ceiling_hlx,
    p_tournament_spend_ceiling_hlx, p_global_session_spend_ceiling_hlx,
    p_realised_stop_loss_hlx, false, p_owner_confirmed_at, p_occurred_at
  ) RETURNING * INTO v_event;
  RETURN NEXT v_event;
END
$function$;

CREATE FUNCTION dna.read_race_entry_owner_control(p_owner_id uuid)
RETURNS SETOF dna.race_entry_owner_control
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN RAISE EXCEPTION 'owner-scoped race-entry control read denied'; END IF;
  RETURN QUERY SELECT control.* FROM dna.race_entry_owner_control control
  WHERE control.owner_id = p_owner_id;
END
$function$;

CREATE FUNCTION dna.read_paid_tournament_segment_guards(
  p_owner_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS SETOF dna.paid_tournament_segment_guard
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100
  THEN RAISE EXCEPTION 'owner-scoped paid Tournament guard read denied'; END IF;
  RETURN QUERY SELECT guard.* FROM dna.paid_tournament_segment_guard guard
  WHERE guard.owner_id = p_owner_id
  ORDER BY guard.tournament_id, guard.bracket_id, guard.core_id
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON TABLE dna.race_entry_owner_control,
  dna.race_entry_owner_control_event, dna.paid_tournament_segment_guard,
  dna.paid_tournament_segment_guard_event FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.configure_race_entry_owner_control(
  uuid,uuid,text,text,boolean,boolean,timestamptz,timestamptz),
  dna.configure_paid_tournament_segment_guard(
  uuid,uuid,text,text,text,text,text,text,text,integer,numeric,numeric,numeric,
  numeric,numeric,timestamptz,timestamptz),
  dna.read_race_entry_owner_control(uuid),
  dna.read_paid_tournament_segment_guards(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.configure_race_entry_owner_control(
  uuid,uuid,text,text,boolean,boolean,timestamptz,timestamptz),
  dna.configure_paid_tournament_segment_guard(
  uuid,uuid,text,text,text,text,text,text,text,integer,numeric,numeric,numeric,
  numeric,numeric,timestamptz,timestamptz),
  dna.read_race_entry_owner_control(uuid),
  dna.read_paid_tournament_segment_guards(uuid,integer) TO dna_app_runtime;

COMMIT;

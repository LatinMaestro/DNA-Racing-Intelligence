BEGIN;

CREATE TABLE dna.dna_open_lab_sync_generation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  source_version text NOT NULL DEFAULT 'v1' CHECK (source_version = 'v1'),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('staged', 'published')),
  published_at timestamptz,
  PRIMARY KEY (owner_id, id),
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CHECK (published_at IS NULL OR published_at >= recorded_at)
);

CREATE TABLE dna.dna_open_lab_sync_family (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  family text NOT NULL CHECK (family IN (
    'vault', 'cores', 'active_races', 'race_fills', 'tokens', 'splice_arena'
  )),
  status text NOT NULL CHECK (
    status IN ('complete', 'partial', 'not_attempted')
  ),
  item_count bigint NOT NULL CHECK (item_count BETWEEN 0 AND 10000000),
  PRIMARY KEY (owner_id, generation_id, family),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
    ON DELETE CASCADE
);

CREATE TABLE dna.dna_open_lab_sync_state (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  accepted_generation_id uuid,
  accepted_observed_at timestamptz,
  accepted_at timestamptz,
  serving_generation_id uuid,
  sync_status text NOT NULL CHECK (
    sync_status IN ('never_synced', 'current', 'paused', 'catching_up')
  ),
  catch_up_required boolean NOT NULL,
  last_attempt_at timestamptz,
  last_interruption_reason text CHECK (
    last_interruption_reason IS NULL OR last_interruption_reason IN (
      'rate_limited', 'api_ineligible', 'api_unavailable',
      'partial_refresh', 'invalid_payload'
    )
  ),
  last_interruption_at timestamptz,
  retry_after_seconds integer CHECK (
    retry_after_seconds IS NULL OR retry_after_seconds BETWEEN 0 AND 86400
  ),
  last_catch_up_completed_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  FOREIGN KEY (owner_id, accepted_generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id),
  FOREIGN KEY (owner_id, serving_generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id),
  CHECK (
    (accepted_generation_id IS NULL) = (accepted_observed_at IS NULL)
    AND (accepted_generation_id IS NULL) = (accepted_at IS NULL)
  ),
  CHECK (serving_generation_id IS NULL OR accepted_generation_id IS NOT NULL),
  CHECK (
    (last_interruption_reason IS NULL) = (last_interruption_at IS NULL)
  ),
  CHECK (retry_after_seconds IS NULL OR last_interruption_reason = 'rate_limited')
);

ALTER TABLE dna.dna_open_lab_sync_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_sync_generation FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_sync_generation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_sync_family ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_sync_family FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_sync_family
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_sync_state FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_sync_state
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.stage_dna_open_lab_sync_candidate(
  p_owner_id uuid,
  p_generation_id uuid,
  p_observed_at timestamptz,
  p_recorded_at timestamptz,
  p_families jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_open_lab_sync_generation%ROWTYPE;
  v_family text;
  v_value jsonb;
  v_status text;
  v_item_count bigint;
  v_key_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab sync denied';
  END IF;
  IF p_observed_at IS NULL OR p_recorded_at IS NULL
     OR p_recorded_at < p_observed_at THEN
    RAISE EXCEPTION 'DNA Open Lab sync timestamps are invalid';
  END IF;
  IF jsonb_typeof(p_families) <> 'object' THEN
    RAISE EXCEPTION 'DNA Open Lab sync families must be an object';
  END IF;

  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_families);
  IF v_key_count <> 6 OR NOT (
    p_families ? 'vault' AND p_families ? 'cores'
    AND p_families ? 'active_races' AND p_families ? 'race_fills'
    AND p_families ? 'tokens' AND p_families ? 'splice_arena'
  ) THEN
    RAISE EXCEPTION 'DNA Open Lab sync family coverage is incomplete';
  END IF;

  FOR v_family, v_value IN SELECT * FROM jsonb_each(p_families)
  LOOP
    IF v_family NOT IN (
      'vault', 'cores', 'active_races', 'race_fills', 'tokens', 'splice_arena'
    ) OR jsonb_typeof(v_value) <> 'object' THEN
      RAISE EXCEPTION 'DNA Open Lab sync family is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_value);
    v_status := v_value ->> 'status';
    IF v_key_count <> 2 OR NOT (v_value ? 'status' AND v_value ? 'itemCount')
       OR v_status NOT IN ('complete', 'partial', 'not_attempted')
       OR jsonb_typeof(v_value -> 'itemCount') <> 'number'
       OR (v_value ->> 'itemCount') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'DNA Open Lab sync family contract is invalid';
    END IF;
    v_item_count := (v_value ->> 'itemCount')::bigint;
    IF v_item_count NOT BETWEEN 0 AND 10000000 THEN
      RAISE EXCEPTION 'DNA Open Lab sync family count is invalid';
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':dna-open-lab:' || p_generation_id::text, 0)
  );

  SELECT generation.* INTO v_generation
  FROM dna.dna_open_lab_sync_generation generation
  WHERE generation.owner_id = p_owner_id AND generation.id = p_generation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_generation.observed_at <> p_observed_at THEN
      RAISE EXCEPTION 'DNA Open Lab sync generation replay conflict';
    END IF;
    IF v_generation.status = 'published' THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_each(p_families) requested(family, value)
        LEFT JOIN dna.dna_open_lab_sync_family stored
          ON stored.owner_id = p_owner_id
          AND stored.generation_id = p_generation_id
          AND stored.family = requested.family
        WHERE stored.family IS NULL
          OR stored.status <> requested.value ->> 'status'
          OR stored.item_count <> (requested.value ->> 'itemCount')::bigint
      ) THEN
        RAISE EXCEPTION 'DNA Open Lab published generation replay conflict';
      END IF;
      RETURN 'published';
    END IF;
    DELETE FROM dna.dna_open_lab_sync_family
    WHERE owner_id = p_owner_id AND generation_id = p_generation_id;
  ELSE
    INSERT INTO dna.dna_open_lab_sync_generation (
      owner_id, id, observed_at, recorded_at, status
    ) VALUES (
      p_owner_id, p_generation_id, p_observed_at, p_recorded_at, 'staged'
    );
  END IF;

  INSERT INTO dna.dna_open_lab_sync_family (
    owner_id, generation_id, family, status, item_count
  )
  SELECT p_owner_id, p_generation_id, entry.key,
    entry.value ->> 'status', (entry.value ->> 'itemCount')::bigint
  FROM jsonb_each(p_families) entry;

  RETURN 'staged';
END
$function$;

CREATE FUNCTION dna.publish_dna_open_lab_sync_candidate(
  p_owner_id uuid,
  p_generation_id uuid,
  p_accepted_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_open_lab_sync_generation%ROWTYPE;
  v_state dna.dna_open_lab_sync_state%ROWTYPE;
  v_complete_count integer;
  v_completed_catch_up boolean := false;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab publication denied';
  END IF;
  IF p_accepted_at IS NULL THEN
    RAISE EXCEPTION 'DNA Open Lab publication timestamp is required';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':dna-open-lab-publication', 0)
  );

  SELECT generation.* INTO v_generation
  FROM dna.dna_open_lab_sync_generation generation
  WHERE generation.owner_id = p_owner_id AND generation.id = p_generation_id
  FOR UPDATE;
  IF NOT FOUND OR p_accepted_at < v_generation.recorded_at THEN
    RAISE EXCEPTION 'DNA Open Lab staged generation is unavailable';
  END IF;

  IF v_generation.status = 'published' THEN
    RETURN 'published';
  END IF;

  SELECT count(*)::integer INTO v_complete_count
  FROM dna.dna_open_lab_sync_family family
  WHERE family.owner_id = p_owner_id
    AND family.generation_id = p_generation_id
    AND family.status = 'complete';
  IF v_complete_count <> 6 THEN
    RAISE EXCEPTION 'DNA Open Lab candidate is incomplete';
  END IF;

  SELECT state.* INTO v_state
  FROM dna.dna_open_lab_sync_state state
  WHERE state.owner_id = p_owner_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_state.accepted_observed_at IS NOT NULL
       AND v_generation.observed_at < v_state.accepted_observed_at THEN
      RAISE EXCEPTION 'DNA Open Lab observation cannot regress behind last-good';
    END IF;
    IF v_state.accepted_at IS NOT NULL AND p_accepted_at < v_state.accepted_at THEN
      RAISE EXCEPTION 'DNA Open Lab publication time cannot regress';
    END IF;
    v_completed_catch_up := v_state.catch_up_required;
  END IF;

  UPDATE dna.dna_open_lab_sync_generation
  SET status = 'published', published_at = COALESCE(published_at, p_accepted_at)
  WHERE owner_id = p_owner_id AND id = p_generation_id;

  INSERT INTO dna.dna_open_lab_sync_state (
    owner_id, accepted_generation_id, accepted_observed_at, accepted_at,
    serving_generation_id, sync_status, catch_up_required, last_attempt_at,
    last_interruption_reason, last_interruption_at, retry_after_seconds,
    last_catch_up_completed_at, revision
  ) VALUES (
    p_owner_id, p_generation_id, v_generation.observed_at, p_accepted_at,
    p_generation_id, 'current', false, p_accepted_at,
    NULL, NULL, NULL, NULL, 1
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    accepted_generation_id = EXCLUDED.accepted_generation_id,
    accepted_observed_at = EXCLUDED.accepted_observed_at,
    accepted_at = EXCLUDED.accepted_at,
    serving_generation_id = EXCLUDED.serving_generation_id,
    sync_status = 'current', catch_up_required = false,
    last_attempt_at = EXCLUDED.last_attempt_at,
    last_interruption_reason = NULL, last_interruption_at = NULL,
    retry_after_seconds = NULL,
    last_catch_up_completed_at = CASE
      WHEN v_completed_catch_up THEN p_accepted_at
      ELSE dna.dna_open_lab_sync_state.last_catch_up_completed_at
    END,
    revision = dna.dna_open_lab_sync_state.revision + 1;

  RETURN 'published';
END
$function$;

CREATE FUNCTION dna.pause_dna_open_lab_sync(
  p_owner_id uuid,
  p_reason text,
  p_attempted_at timestamptz,
  p_retry_after_seconds integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_state dna.dna_open_lab_sync_state%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab pause denied';
  END IF;
  IF p_reason NOT IN (
    'rate_limited', 'api_ineligible', 'api_unavailable',
    'partial_refresh', 'invalid_payload'
  ) OR p_attempted_at IS NULL
     OR (p_retry_after_seconds IS NOT NULL AND (
       p_reason <> 'rate_limited' OR p_retry_after_seconds NOT BETWEEN 0 AND 86400
     )) THEN
    RAISE EXCEPTION 'DNA Open Lab pause contract is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':dna-open-lab-publication', 0)
  );
  SELECT state.* INTO v_state
  FROM dna.dna_open_lab_sync_state state
  WHERE state.owner_id = p_owner_id
  FOR UPDATE;
  IF FOUND AND v_state.last_attempt_at IS NOT NULL
     AND p_attempted_at < v_state.last_attempt_at THEN
    RAISE EXCEPTION 'DNA Open Lab pause time cannot regress';
  END IF;

  INSERT INTO dna.dna_open_lab_sync_state (
    owner_id, sync_status, catch_up_required, last_attempt_at,
    last_interruption_reason, last_interruption_at, retry_after_seconds, revision
  ) VALUES (
    p_owner_id, 'paused', true, p_attempted_at,
    p_reason, p_attempted_at, p_retry_after_seconds, 1
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    serving_generation_id = dna.dna_open_lab_sync_state.accepted_generation_id,
    sync_status = 'paused', catch_up_required = true,
    last_attempt_at = EXCLUDED.last_attempt_at,
    last_interruption_reason = EXCLUDED.last_interruption_reason,
    last_interruption_at = EXCLUDED.last_interruption_at,
    retry_after_seconds = EXCLUDED.retry_after_seconds,
    revision = dna.dna_open_lab_sync_state.revision + 1;
  RETURN 'paused';
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_sync_state(p_owner_id uuid)
RETURNS SETOF dna.dna_open_lab_sync_state
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab state read denied';
  END IF;
  RETURN QUERY
  SELECT state.* FROM dna.dna_open_lab_sync_state state
  WHERE state.owner_id = p_owner_id;
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_sync_generation FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_sync_family FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_sync_state FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.stage_dna_open_lab_sync_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_dna_open_lab_sync_candidate(
  uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.pause_dna_open_lab_sync(
  uuid, text, timestamptz, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_sync_state(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.stage_dna_open_lab_sync_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_dna_open_lab_sync_candidate(
  uuid, uuid, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.pause_dna_open_lab_sync(
  uuid, text, timestamptz, integer
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_sync_state(uuid)
TO dna_app_runtime;

COMMIT;

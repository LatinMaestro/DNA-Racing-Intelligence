BEGIN;

CREATE TABLE dna.dna_open_lab_sync_rate_policy (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  requested_requests_per_minute integer NOT NULL DEFAULT 30
    CHECK (requested_requests_per_minute BETWEEN 30 AND 150),
  effective_requests_per_minute integer NOT NULL DEFAULT 30
    CHECK (effective_requests_per_minute BETWEEN 30 AND 150),
  elevated_until timestamptz,
  fallback_reason text CHECK (fallback_reason IN (
    'elevation_expired', 'provider_limit_reduced', 'rate_limit_observed'
  )),
  consecutive_rate_limits integer NOT NULL DEFAULT 0
    CHECK (consecutive_rate_limits >= 0),
  last_rate_limited_at timestamptz,
  last_provider_limit integer CHECK (last_provider_limit > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (requested_requests_per_minute <= 30 AND elevated_until IS NULL)
    OR (requested_requests_per_minute > 30 AND elevated_until IS NOT NULL)
  )
);

ALTER TABLE dna.dna_open_lab_sync_rate_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_sync_rate_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_sync_rate_policy
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_dna_open_lab_sync_rate_policy(p_owner_id uuid)
RETURNS TABLE (
  requested_requests_per_minute integer,
  effective_requests_per_minute integer,
  elevated_until timestamptz,
  fallback_reason text,
  consecutive_rate_limits integer,
  last_rate_limited_at timestamptz,
  last_provider_limit integer,
  version bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab rate policy read denied';
  END IF;
  RETURN QUERY
  SELECT
    policy.requested_requests_per_minute,
    CASE
      WHEN policy.requested_requests_per_minute > 30
        AND policy.elevated_until <= clock_timestamp() THEN 30
      ELSE policy.effective_requests_per_minute
    END,
    policy.elevated_until,
    CASE
      WHEN policy.requested_requests_per_minute > 30
        AND policy.elevated_until <= clock_timestamp()
        THEN 'elevation_expired'::text
      ELSE policy.fallback_reason
    END,
    policy.consecutive_rate_limits,
    policy.last_rate_limited_at,
    policy.last_provider_limit,
    policy.version,
    policy.updated_at
  FROM dna.dna_open_lab_sync_rate_policy policy
  WHERE policy.owner_id = p_owner_id;
END
$function$;

CREATE FUNCTION dna.set_dna_open_lab_sync_rate_policy(
  p_owner_id uuid,
  p_requested_requests_per_minute integer,
  p_elevated_until timestamptz,
  p_expected_version bigint,
  p_requested_at timestamptz
)
RETURNS SETOF dna.dna_open_lab_sync_rate_policy
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing_version bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab rate policy write denied';
  END IF;
  IF p_requested_requests_per_minute IS NULL
     OR p_requested_requests_per_minute NOT BETWEEN 30 AND 150
     OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_requested_at IS NULL OR p_requested_at > clock_timestamp() + interval '5 minutes'
     OR (p_requested_requests_per_minute <= 30 AND p_elevated_until IS NOT NULL)
     OR (p_requested_requests_per_minute > 30 AND (
       p_elevated_until IS NULL
       OR p_elevated_until <= p_requested_at
       OR p_elevated_until > p_requested_at + interval '31 days'
     )) THEN
    RAISE EXCEPTION 'DNA Open Lab rate policy input is invalid';
  END IF;

  SELECT policy.version INTO v_existing_version
  FROM dna.dna_open_lab_sync_rate_policy policy
  WHERE policy.owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_version <> 0 THEN
      RAISE EXCEPTION 'DNA Open Lab rate policy changed; refresh before retrying';
    END IF;
    INSERT INTO dna.dna_open_lab_sync_rate_policy (
      owner_id, requested_requests_per_minute,
      effective_requests_per_minute, elevated_until, updated_at
    ) VALUES (
      p_owner_id, p_requested_requests_per_minute,
      p_requested_requests_per_minute, p_elevated_until, p_requested_at
    );
  ELSE
    IF p_expected_version <> v_existing_version THEN
      RAISE EXCEPTION 'DNA Open Lab rate policy changed; refresh before retrying';
    END IF;
    UPDATE dna.dna_open_lab_sync_rate_policy policy SET
      requested_requests_per_minute = p_requested_requests_per_minute,
      effective_requests_per_minute = p_requested_requests_per_minute,
      elevated_until = p_elevated_until,
      fallback_reason = NULL,
      consecutive_rate_limits = 0,
      last_rate_limited_at = NULL,
      version = policy.version + 1,
      updated_at = p_requested_at
    WHERE policy.owner_id = p_owner_id;
  END IF;
  RETURN QUERY SELECT * FROM dna.dna_open_lab_sync_rate_policy policy
    WHERE policy.owner_id = p_owner_id;
END
$function$;

CREATE FUNCTION dna.record_dna_open_lab_rate_observation(
  p_owner_id uuid,
  p_rate_limited boolean,
  p_provider_limit integer,
  p_observed_at timestamptz
)
RETURNS SETOF dna.dna_open_lab_sync_rate_policy
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_policy dna.dna_open_lab_sync_rate_policy%ROWTYPE;
  v_consecutive integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab rate observation denied';
  END IF;
  IF p_rate_limited IS NULL OR p_observed_at IS NULL
     OR p_observed_at > clock_timestamp() + interval '5 minutes'
     OR (p_provider_limit IS NOT NULL AND p_provider_limit < 1) THEN
    RAISE EXCEPTION 'DNA Open Lab rate observation is invalid';
  END IF;
  SELECT * INTO v_policy FROM dna.dna_open_lab_sync_rate_policy policy
  WHERE policy.owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO dna.dna_open_lab_sync_rate_policy (owner_id)
    VALUES (p_owner_id) RETURNING * INTO v_policy;
  END IF;

  IF v_policy.requested_requests_per_minute > 30
     AND v_policy.elevated_until <= p_observed_at THEN
    UPDATE dna.dna_open_lab_sync_rate_policy SET
      effective_requests_per_minute = 30,
      fallback_reason = 'elevation_expired',
      updated_at = p_observed_at,
      version = version + 1
    WHERE owner_id = p_owner_id;
  ELSIF p_rate_limited THEN
    v_consecutive := CASE
      WHEN v_policy.last_rate_limited_at IS NOT NULL
       AND p_observed_at - v_policy.last_rate_limited_at <= interval '5 minutes'
      THEN v_policy.consecutive_rate_limits + 1 ELSE 1 END;
    UPDATE dna.dna_open_lab_sync_rate_policy SET
      effective_requests_per_minute = CASE
        WHEN effective_requests_per_minute > 30 THEN 30
        ELSE effective_requests_per_minute END,
      fallback_reason = CASE
        WHEN p_provider_limit <= 30 THEN 'provider_limit_reduced'
        WHEN effective_requests_per_minute > 30 THEN 'rate_limit_observed'
        ELSE fallback_reason END,
      consecutive_rate_limits = v_consecutive,
      last_rate_limited_at = p_observed_at,
      last_provider_limit = p_provider_limit,
      updated_at = p_observed_at,
      version = version + 1
    WHERE owner_id = p_owner_id;
  ELSE
    UPDATE dna.dna_open_lab_sync_rate_policy SET
      consecutive_rate_limits = 0,
      last_provider_limit = p_provider_limit,
      updated_at = p_observed_at,
      version = version + 1
    WHERE owner_id = p_owner_id;
  END IF;
  RETURN QUERY SELECT * FROM dna.dna_open_lab_sync_rate_policy policy
    WHERE policy.owner_id = p_owner_id;
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_sync_rate_policy FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_sync_rate_policy FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_sync_rate_policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.set_dna_open_lab_sync_rate_policy(uuid,integer,timestamptz,bigint,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_dna_open_lab_rate_observation(uuid,boolean,integer,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_sync_rate_policy(uuid) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.set_dna_open_lab_sync_rate_policy(uuid,integer,timestamptz,bigint,timestamptz) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_dna_open_lab_rate_observation(uuid,boolean,integer,timestamptz) TO dna_app_runtime;

COMMIT;

BEGIN;

CREATE TABLE dna.aggregate_refresh_processing (
  owner_id uuid NOT NULL,
  refresh_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  state text NOT NULL CHECK (state IN ('processing', 'failed', 'published')),
  source_version_set_sha256 character(64) NOT NULL CHECK (
    source_version_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  failure_reason text CHECK (
    failure_reason IS NULL OR failure_reason IN (
      'refresher_failed', 'publish_failed', 'source_versions_superseded'
    )
  ),
  failed_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, refresh_id),
  FOREIGN KEY (owner_id, refresh_id)
    REFERENCES dna.aggregate_refresh_job(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE,
  CHECK (lease_expires_at > claimed_at),
  CHECK ((state = 'failed') = (failure_reason IS NOT NULL AND failed_at IS NOT NULL)),
  CHECK ((state = 'published') = (published_at IS NOT NULL))
);

CREATE INDEX aggregate_refresh_processing_lease
  ON dna.aggregate_refresh_processing(owner_id, state, lease_expires_at);

ALTER TABLE dna.aggregate_refresh_processing ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.aggregate_refresh_processing FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.aggregate_refresh_processing
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.active_pro_league_source_version_set_sha256(p_owner_id uuid)
RETURNS character(64)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT encode(sha256(convert_to(COALESCE(string_agg(
    version.source_type || ':' || version.id::text || ':' || version.version_number::text,
    '|' ORDER BY version.source_type, version.version_number, version.id
  ), 'none'), 'UTF8')), 'hex')::character(64)
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.source_type IN ('race_merge', 'core_details', 'current_arena')
    AND version.is_active
    AND version.rolled_back_at IS NULL
$function$;

CREATE FUNCTION dna.claim_pro_league_aggregate_refresh(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_worker_id text,
  p_claimed_at timestamptz,
  p_lease_expires_at timestamptz
)
RETURNS TABLE (
  status text,
  authenticated_owner_id text,
  dataset_version_id uuid,
  source_version_set_sha256 character(64),
  retry_after timestamptz,
  aggregate_set_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_job dna.aggregate_refresh_job%ROWTYPE;
  v_processing dna.aggregate_refresh_processing%ROWTYPE;
  v_owner_clerk_id text;
  v_source_hash character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped aggregate refresh denied';
  END IF;
  IF p_lease_expires_at <= p_claimed_at THEN
    RAISE EXCEPTION 'aggregate refresh lease is invalid';
  END IF;

  SELECT job.* INTO v_job
  FROM dna.aggregate_refresh_job job
  WHERE job.owner_id = p_owner_id AND job.id = p_refresh_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status = 'rolled_back' THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid,
      NULL::character(64), NULL::timestamptz, NULL::uuid;
    RETURN;
  END IF;

  IF v_job.status = 'completed' THEN
    RETURN QUERY SELECT 'already_complete'::text, NULL::text,
      v_job.dataset_version_id, NULL::character(64), NULL::timestamptz,
      v_job.id;
    RETURN;
  END IF;

  SELECT processing.* INTO v_processing
  FROM dna.aggregate_refresh_processing processing
  WHERE processing.owner_id = p_owner_id
    AND processing.refresh_id = p_refresh_id;

  IF FOUND
     AND v_processing.state = 'processing'
     AND v_processing.lease_expires_at > p_claimed_at
     AND v_processing.worker_id <> p_worker_id THEN
    RETURN QUERY SELECT 'leased_elsewhere'::text, NULL::text,
      v_job.dataset_version_id, NULL::character(64),
      v_processing.lease_expires_at, NULL::uuid;
    RETURN;
  END IF;

  SELECT owner.clerk_user_id INTO STRICT v_owner_clerk_id
  FROM dna.app_owner owner WHERE owner.id = p_owner_id;
  v_source_hash := dna.active_pro_league_source_version_set_sha256(p_owner_id);

  INSERT INTO dna.aggregate_refresh_processing (
    owner_id, refresh_id, dataset_version_id, worker_id, state,
    source_version_set_sha256, claimed_at, lease_expires_at
  ) VALUES (
    p_owner_id, p_refresh_id, v_job.dataset_version_id, p_worker_id,
    'processing', v_source_hash, p_claimed_at, p_lease_expires_at
  )
  ON CONFLICT (owner_id, refresh_id) DO UPDATE
  SET dataset_version_id = EXCLUDED.dataset_version_id,
      worker_id = EXCLUDED.worker_id,
      state = 'processing',
      source_version_set_sha256 = EXCLUDED.source_version_set_sha256,
      claimed_at = EXCLUDED.claimed_at,
      lease_expires_at = EXCLUDED.lease_expires_at,
      failure_reason = NULL,
      failed_at = NULL,
      published_at = NULL,
      updated_at = now();

  RETURN QUERY SELECT 'claimed'::text, v_owner_clerk_id,
    v_job.dataset_version_id, v_source_hash, NULL::timestamptz, NULL::uuid;
END
$function$;

CREATE FUNCTION dna.prepare_pro_league_aggregate_refresh(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_source_version_set_sha256 character(64)
)
RETURNS TABLE (
  prepared_aggregate_set_id uuid,
  source_version_set_sha256 character(64),
  aggregate_family_count integer,
  materialized_row_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_materialized_row_count bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped aggregate refresh denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = p_dataset_version_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = p_source_version_set_sha256
  ) THEN
    RAISE EXCEPTION 'aggregate refresh claim is unavailable';
  END IF;

  SELECT result.materialized_row_count
  INTO v_materialized_row_count
  FROM dna.refresh_pro_league_aggregates(
    p_dataset_version_id, statement_timestamp()
  ) result;

  RETURN QUERY SELECT p_refresh_id, p_source_version_set_sha256,
    4, v_materialized_row_count;
END
$function$;

CREATE FUNCTION dna.publish_pro_league_aggregate_refresh(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_worker_id text,
  p_prepared_aggregate_set_id uuid,
  p_source_version_set_sha256 character(64),
  p_aggregate_family_count integer,
  p_materialized_row_count bigint,
  p_completed_at timestamptz
)
RETURNS TABLE (status text, aggregate_set_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_current_hash character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped aggregate publication denied';
  END IF;
  IF p_prepared_aggregate_set_id <> p_refresh_id OR p_aggregate_family_count <> 4 THEN
    RAISE EXCEPTION 'prepared aggregate evidence is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = p_dataset_version_id
      AND processing.worker_id = p_worker_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = p_source_version_set_sha256
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.aggregate_refresh_job job
    WHERE job.owner_id = p_owner_id AND job.id = p_refresh_id
      AND job.dataset_version_id = p_dataset_version_id
      AND job.status = 'completed'
      AND job.affected_record_count = p_materialized_row_count
  ) THEN
    RAISE EXCEPTION 'prepared aggregate publication claim is unavailable';
  END IF;

  v_current_hash := dna.active_pro_league_source_version_set_sha256(p_owner_id);
  IF v_current_hash <> p_source_version_set_sha256 THEN
    UPDATE dna.aggregate_refresh_processing
    SET state = 'failed', failure_reason = 'source_versions_superseded',
        failed_at = p_completed_at, published_at = NULL, updated_at = now()
    WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id;
    UPDATE dna.aggregate_refresh_job
    SET status = 'failed', completed_at = NULL, affected_record_count = NULL,
        failure_code = 'source_version_set_superseded'
    WHERE owner_id = p_owner_id AND id = p_refresh_id;
    UPDATE dna.dataset_version
    SET aggregate_refreshed_at = NULL
    WHERE owner_id = p_owner_id AND id = p_dataset_version_id;
    RETURN QUERY SELECT 'superseded'::text, NULL::uuid;
    RETURN;
  END IF;

  UPDATE dna.aggregate_refresh_processing
  SET state = 'published', published_at = p_completed_at,
      failure_reason = NULL, failed_at = NULL, updated_at = now()
  WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id;
  RETURN QUERY SELECT 'published'::text, p_refresh_id;
END
$function$;

CREATE FUNCTION dna.record_pro_league_aggregate_refresh_failure(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_worker_id text,
  p_failed_at timestamptz,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped aggregate refresh denied';
  END IF;
  IF p_reason NOT IN ('refresher_failed', 'publish_failed') THEN
    RAISE EXCEPTION 'aggregate refresh failure reason is invalid';
  END IF;
  UPDATE dna.aggregate_refresh_processing
  SET state = 'failed', failure_reason = p_reason, failed_at = p_failed_at,
      published_at = NULL, updated_at = now()
  WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id
    AND dataset_version_id = p_dataset_version_id
    AND worker_id = p_worker_id AND state = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'aggregate refresh claim is unavailable'; END IF;
  UPDATE dna.aggregate_refresh_job
  SET status = 'failed', completed_at = NULL, affected_record_count = NULL,
      failure_code = p_reason
  WHERE owner_id = p_owner_id AND id = p_refresh_id;
END
$function$;

REVOKE ALL ON TABLE dna.aggregate_refresh_processing FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.active_pro_league_source_version_set_sha256(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.claim_pro_league_aggregate_refresh(
  uuid, uuid, text, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_pro_league_aggregate_refresh_failure(
  uuid, uuid, uuid, text, timestamptz, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.claim_pro_league_aggregate_refresh(
  uuid, uuid, text, timestamptz, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_pro_league_aggregate_refresh_failure(
  uuid, uuid, uuid, text, timestamptz, text
) TO dna_app_runtime;

COMMIT;

BEGIN;

CREATE TABLE dna.import_activation_dispatch (
  owner_id uuid NOT NULL,
  id uuid NOT NULL,
  update_session_id uuid NOT NULL,
  preview_dispatch_id uuid NOT NULL,
  preview_id text NOT NULL CHECK (
    preview_id = btrim(preview_id)
    AND preview_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  preview_fingerprint_sha256 character(64) NOT NULL CHECK (
    preview_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  idempotency_key text NOT NULL CHECK (
    idempotency_key = btrim(idempotency_key)
    AND idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  state text NOT NULL CHECK (state IN ('pending', 'queued', 'failed')),
  confirmed_at timestamptz NOT NULL,
  queued_at timestamptz,
  failure_reason text CHECK (
    failure_reason IS NULL OR failure_reason = 'queue_unavailable'
  ),
  failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, update_session_id),
  UNIQUE (owner_id, id, update_session_id),
  UNIQUE (owner_id, preview_dispatch_id),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, preview_dispatch_id)
    REFERENCES dna.import_prepared_preview(owner_id, preview_dispatch_id)
    ON DELETE CASCADE,
  CHECK ((state = 'queued') = (queued_at IS NOT NULL)),
  CHECK (
    (state = 'failed') =
      (failure_reason IS NOT NULL AND failed_at IS NOT NULL)
  )
);

CREATE TABLE dna.import_activation_processing (
  owner_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  update_session_id uuid NOT NULL,
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  state text NOT NULL CHECK (state IN ('processing', 'failed', 'complete')),
  preview_fingerprint_sha256 character(64) NOT NULL CHECK (
    preview_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  prepared_result_id text CHECK (
    prepared_result_id IS NULL OR (
      prepared_result_id = btrim(prepared_result_id)
      AND prepared_result_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
    )
  ),
  source_version_count integer CHECK (
    source_version_count IS NULL OR source_version_count > 0
  ),
  quarantined_record_count bigint CHECK (
    quarantined_record_count IS NULL OR quarantined_record_count >= 0
  ),
  aggregate_refresh_required boolean,
  failure_reason text CHECK (
    failure_reason IS NULL OR failure_reason = 'processor_failed'
  ),
  failed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, dispatch_id),
  FOREIGN KEY (owner_id, dispatch_id, update_session_id)
    REFERENCES dna.import_activation_dispatch(
      owner_id, id, update_session_id
    )
    ON DELETE CASCADE,
  CHECK (lease_expires_at > claimed_at),
  CHECK ((state = 'failed') = (failure_reason IS NOT NULL AND failed_at IS NOT NULL)),
  CHECK (
    (state = 'complete') = (
      completed_at IS NOT NULL
      AND prepared_result_id IS NOT NULL
      AND source_version_count IS NOT NULL
      AND quarantined_record_count IS NOT NULL
      AND aggregate_refresh_required IS NOT NULL
    )
  )
);

CREATE INDEX import_activation_dispatch_state
  ON dna.import_activation_dispatch(owner_id, state, confirmed_at);
CREATE INDEX import_activation_processing_lease
  ON dna.import_activation_processing(owner_id, state, lease_expires_at);

ALTER TABLE dna.import_activation_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_activation_dispatch FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.import_activation_processing ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_activation_processing FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.import_activation_dispatch
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.import_activation_processing
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.reserve_import_activation(
  p_owner_id uuid,
  p_preview_id text,
  p_preview_fingerprint_sha256 character(64),
  p_idempotency_key text,
  p_confirmed_at timestamptz
)
RETURNS TABLE (
  disposition text,
  update_session_id uuid,
  dispatch_id uuid,
  dispatch_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_preview dna.import_prepared_preview%ROWTYPE;
  v_existing dna.import_activation_dispatch%ROWTYPE;
  v_update_session_id uuid;
  v_dispatch_id uuid;
  v_inserted integer := 0;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import activation denied';
  END IF;

  SELECT prepared.* INTO v_preview
  FROM dna.import_prepared_preview prepared
  WHERE prepared.owner_id = p_owner_id
    AND prepared.preview_id = p_preview_id
    AND prepared.preview_fingerprint_sha256 = p_preview_fingerprint_sha256
    AND prepared.confirmable
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmable prepared Preview is unavailable';
  END IF;

  SELECT dispatch.* INTO v_existing
  FROM dna.import_activation_dispatch dispatch
  WHERE dispatch.owner_id = p_owner_id
    AND (
      dispatch.idempotency_key = p_idempotency_key
      OR dispatch.preview_dispatch_id = v_preview.preview_dispatch_id
    )
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.preview_dispatch_id <> v_preview.preview_dispatch_id
       OR v_existing.preview_fingerprint_sha256 <> p_preview_fingerprint_sha256 THEN
      RAISE EXCEPTION 'import activation idempotency conflict';
    END IF;
    RETURN QUERY SELECT 'existing'::text, v_existing.update_session_id,
      v_existing.id,
      CASE WHEN v_existing.state = 'queued' THEN 'queued' ELSE 'pending' END;
    RETURN;
  END IF;

  v_update_session_id := md5(
    p_owner_id::text || ':activation_session:' || v_preview.preview_dispatch_id::text
  )::uuid;
  v_dispatch_id := md5(v_update_session_id::text || ':dispatch')::uuid;

  INSERT INTO dna.import_activation_dispatch (
    owner_id, id, update_session_id, preview_dispatch_id, preview_id,
    preview_fingerprint_sha256, idempotency_key, state, confirmed_at
  ) VALUES (
    p_owner_id, v_dispatch_id, v_update_session_id,
    v_preview.preview_dispatch_id, p_preview_id,
    p_preview_fingerprint_sha256, p_idempotency_key, 'pending', p_confirmed_at
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN RAISE EXCEPTION 'import activation reservation failed'; END IF;

  RETURN QUERY SELECT 'created'::text, v_update_session_id,
    v_dispatch_id, 'pending'::text;
END
$function$;

CREATE FUNCTION dna.mark_import_activation_dispatch_queued(
  p_owner_id uuid,
  p_update_session_id uuid,
  p_dispatch_id uuid,
  p_queued_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import activation denied';
  END IF;
  UPDATE dna.import_activation_dispatch
  SET state = 'queued', queued_at = p_queued_at,
      failure_reason = NULL, failed_at = NULL, updated_at = now()
  WHERE owner_id = p_owner_id AND id = p_dispatch_id
    AND update_session_id = p_update_session_id
    AND state IN ('pending', 'failed', 'queued');
  IF NOT FOUND THEN RAISE EXCEPTION 'import activation dispatch is unavailable'; END IF;
END
$function$;

CREATE FUNCTION dna.mark_import_activation_dispatch_failed(
  p_owner_id uuid,
  p_update_session_id uuid,
  p_dispatch_id uuid,
  p_failed_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import activation denied';
  END IF;
  UPDATE dna.import_activation_dispatch
  SET state = 'failed', queued_at = NULL, failure_reason = 'queue_unavailable',
      failed_at = p_failed_at, updated_at = now()
  WHERE owner_id = p_owner_id AND id = p_dispatch_id
    AND update_session_id = p_update_session_id AND state <> 'queued';
  IF NOT FOUND THEN RAISE EXCEPTION 'import activation dispatch is unavailable'; END IF;
END
$function$;

CREATE FUNCTION dna.claim_import_activation_dispatch(
  p_owner_id uuid,
  p_dispatch_id uuid,
  p_worker_id text,
  p_claimed_at timestamptz,
  p_lease_expires_at timestamptz
)
RETURNS TABLE (
  status text,
  authenticated_owner_id text,
  update_session_id uuid,
  preview_fingerprint_sha256 character(64),
  retry_after timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_dispatch dna.import_activation_dispatch%ROWTYPE;
  v_processing dna.import_activation_processing%ROWTYPE;
  v_owner_clerk_id text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import activation denied';
  END IF;
  IF p_lease_expires_at <= p_claimed_at THEN
    RAISE EXCEPTION 'import activation lease is invalid';
  END IF;

  SELECT dispatch.* INTO v_dispatch
  FROM dna.import_activation_dispatch dispatch
  WHERE dispatch.owner_id = p_owner_id AND dispatch.id = p_dispatch_id
    AND dispatch.state = 'queued'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid,
      NULL::character(64), NULL::timestamptz;
    RETURN;
  END IF;

  SELECT processing.* INTO v_processing
  FROM dna.import_activation_processing processing
  WHERE processing.owner_id = p_owner_id
    AND processing.dispatch_id = p_dispatch_id;
  IF FOUND AND v_processing.state = 'complete' THEN
    RETURN QUERY SELECT 'already_complete'::text, NULL::text,
      v_dispatch.update_session_id, NULL::character(64), NULL::timestamptz;
    RETURN;
  END IF;
  IF FOUND AND v_processing.state = 'processing'
     AND v_processing.lease_expires_at > p_claimed_at
     AND v_processing.worker_id <> p_worker_id THEN
    RETURN QUERY SELECT 'leased_elsewhere'::text, NULL::text,
      v_dispatch.update_session_id, NULL::character(64),
      v_processing.lease_expires_at;
    RETURN;
  END IF;

  SELECT owner.clerk_user_id INTO STRICT v_owner_clerk_id
  FROM dna.app_owner owner WHERE owner.id = p_owner_id;
  INSERT INTO dna.import_activation_processing (
    owner_id, dispatch_id, update_session_id, worker_id, state,
    preview_fingerprint_sha256, claimed_at, lease_expires_at
  ) VALUES (
    p_owner_id, p_dispatch_id, v_dispatch.update_session_id, p_worker_id,
    'processing', v_dispatch.preview_fingerprint_sha256,
    p_claimed_at, p_lease_expires_at
  )
  ON CONFLICT (owner_id, dispatch_id) DO UPDATE
  SET worker_id = EXCLUDED.worker_id, state = 'processing',
      preview_fingerprint_sha256 = EXCLUDED.preview_fingerprint_sha256,
      claimed_at = EXCLUDED.claimed_at,
      lease_expires_at = EXCLUDED.lease_expires_at,
      prepared_result_id = NULL, source_version_count = NULL,
      quarantined_record_count = NULL, aggregate_refresh_required = NULL,
      failure_reason = NULL, failed_at = NULL, completed_at = NULL,
      updated_at = now();

  RETURN QUERY SELECT 'claimed'::text, v_owner_clerk_id,
    v_dispatch.update_session_id, v_dispatch.preview_fingerprint_sha256,
    NULL::timestamptz;
END
$function$;

CREATE FUNCTION dna.complete_import_activation(
  p_owner_id uuid,
  p_update_session_id uuid,
  p_dispatch_id uuid,
  p_prepared_result_id text,
  p_completed_at timestamptz,
  p_source_version_count integer,
  p_quarantined_record_count bigint,
  p_aggregate_refresh_required boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_preview_dispatch_id uuid;
  v_source_version_count bigint;
  v_quarantined_record_count bigint;
  v_aggregate_job_count bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import activation denied';
  END IF;
  SELECT dispatch.preview_dispatch_id INTO v_preview_dispatch_id
  FROM dna.import_activation_dispatch dispatch
  JOIN dna.import_activation_processing processing
    ON processing.owner_id = dispatch.owner_id
    AND processing.dispatch_id = dispatch.id
  WHERE dispatch.owner_id = p_owner_id AND dispatch.id = p_dispatch_id
    AND dispatch.update_session_id = p_update_session_id
    AND processing.state = 'processing'
  FOR UPDATE OF processing;
  IF NOT FOUND THEN RAISE EXCEPTION 'import activation claim is unavailable'; END IF;

  SELECT count(DISTINCT version.id), COALESCE(sum(batch.rejected_rows), 0),
    count(DISTINCT job.id)
  INTO v_source_version_count, v_quarantined_record_count,
    v_aggregate_job_count
  FROM dna.import_verified_upload_object object
  JOIN dna.import_batch batch
    ON batch.owner_id = object.owner_id AND batch.id = object.upload_file_id
  LEFT JOIN dna.dataset_version version
    ON version.owner_id = batch.owner_id AND version.import_batch_id = batch.id
    AND version.rolled_back_at IS NULL
  LEFT JOIN dna.aggregate_refresh_job job
    ON job.owner_id = version.owner_id
    AND job.dataset_version_id = version.id
    AND job.status IN ('queued', 'running', 'completed')
  WHERE object.owner_id = p_owner_id
    AND object.preview_dispatch_id = v_preview_dispatch_id;

  IF v_source_version_count <> p_source_version_count
     OR v_source_version_count < 1
     OR v_quarantined_record_count <> p_quarantined_record_count
     OR v_aggregate_job_count <> v_source_version_count
     OR p_aggregate_refresh_required <> (v_aggregate_job_count > 0) THEN
    RAISE EXCEPTION 'prepared import activation evidence is invalid';
  END IF;

  UPDATE dna.import_activation_processing
  SET state = 'complete', prepared_result_id = p_prepared_result_id,
      source_version_count = p_source_version_count,
      quarantined_record_count = p_quarantined_record_count,
      aggregate_refresh_required = p_aggregate_refresh_required,
      completed_at = p_completed_at, failure_reason = NULL, failed_at = NULL,
      updated_at = now()
  WHERE owner_id = p_owner_id AND dispatch_id = p_dispatch_id
    AND update_session_id = p_update_session_id AND state = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'import activation claim is unavailable'; END IF;
END
$function$;

CREATE FUNCTION dna.record_import_activation_failure(
  p_owner_id uuid,
  p_update_session_id uuid,
  p_dispatch_id uuid,
  p_worker_id text,
  p_failed_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import activation denied';
  END IF;
  UPDATE dna.import_activation_processing
  SET state = 'failed', failure_reason = 'processor_failed',
      failed_at = p_failed_at, completed_at = NULL, updated_at = now()
  WHERE owner_id = p_owner_id AND dispatch_id = p_dispatch_id
    AND update_session_id = p_update_session_id AND worker_id = p_worker_id
    AND state = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'import activation claim is unavailable'; END IF;
END
$function$;

REVOKE ALL ON TABLE dna.import_activation_dispatch FROM PUBLIC;
REVOKE ALL ON TABLE dna.import_activation_processing FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.reserve_import_activation(
  uuid, text, character, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.mark_import_activation_dispatch_queued(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.mark_import_activation_dispatch_failed(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.claim_import_activation_dispatch(
  uuid, uuid, text, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.complete_import_activation(
  uuid, uuid, uuid, text, timestamptz, integer, bigint, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_import_activation_failure(
  uuid, uuid, uuid, text, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.reserve_import_activation(
  uuid, text, character, text, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.mark_import_activation_dispatch_queued(
  uuid, uuid, uuid, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.mark_import_activation_dispatch_failed(
  uuid, uuid, uuid, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.claim_import_activation_dispatch(
  uuid, uuid, text, timestamptz, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.complete_import_activation(
  uuid, uuid, uuid, text, timestamptz, integer, bigint, boolean
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_import_activation_failure(
  uuid, uuid, uuid, text, timestamptz
) TO dna_app_runtime;

COMMIT;

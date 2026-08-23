BEGIN;

CREATE TABLE dna.import_confirmation_cleanup (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  upload_batch_id uuid NOT NULL,
  request_fingerprint_sha256 character(64) NOT NULL CHECK (
    request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  preview_dispatch_id uuid NOT NULL,
  preview_id text NOT NULL CHECK (
    preview_id = btrim(preview_id)
    AND preview_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  preview_fingerprint_sha256 character(64) NOT NULL CHECK (
    preview_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  update_session_id uuid NOT NULL,
  activation_dispatch_id uuid NOT NULL,
  activation_idempotency_key text NOT NULL CHECK (
    activation_idempotency_key = btrim(activation_idempotency_key)
    AND activation_idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  pre_activation_cleanup_id uuid NOT NULL,
  reason text NOT NULL CHECK (
    reason = btrim(reason)
    AND length(reason) BETWEEN 10 AND 500
    AND reason !~ '[[:cntrl:]]'
  ),
  file_count integer NOT NULL CHECK (file_count BETWEEN 1 AND 24),
  verified_object_count integer NOT NULL CHECK (
    verified_object_count BETWEEN 0 AND file_count
  ),
  staged_batch_count integer NOT NULL CHECK (
    staged_batch_count BETWEEN 0 AND file_count
  ),
  cleaned_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, upload_batch_id),
  UNIQUE (owner_id, activation_dispatch_id)
);

ALTER TABLE dna.import_confirmation_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_confirmation_cleanup FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.import_confirmation_cleanup
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.cleanup_confirmed_import_before_dispatch(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_request_fingerprint_sha256 character(64),
  p_preview_id text,
  p_preview_fingerprint_sha256 character(64),
  p_update_session_id uuid,
  p_activation_dispatch_id uuid,
  p_reason text,
  p_cleaned_at timestamptz
)
RETURNS TABLE (
  status text,
  confirmation_cleanup_id uuid,
  pre_activation_cleanup_id uuid,
  file_count integer,
  verified_object_count integer,
  staged_batch_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.import_confirmation_cleanup%ROWTYPE;
  v_context record;
  v_cleanup record;
  v_confirmation_cleanup_id uuid := md5(
    p_owner_id::text || ':confirmation_cleanup:' || p_activation_dispatch_id::text
  )::uuid;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped confirmed import cleanup denied';
  END IF;
  IF p_cleaned_at IS NULL THEN
    RAISE EXCEPTION 'confirmed import cleanup timestamp is required';
  END IF;
  IF p_reason IS NULL
     OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500
     OR btrim(p_reason) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'cleanup reason must contain between 10 and 500 printable characters';
  END IF;
  IF p_preview_id IS NULL OR p_preview_id <> btrim(p_preview_id)
     OR p_preview_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$' THEN
    RAISE EXCEPTION 'confirmed import cleanup preview id is invalid';
  END IF;

  SELECT cleanup.* INTO v_existing
  FROM dna.import_confirmation_cleanup cleanup
  WHERE cleanup.owner_id = p_owner_id
    AND cleanup.activation_dispatch_id = p_activation_dispatch_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.upload_batch_id <> p_upload_batch_id
       OR v_existing.request_fingerprint_sha256 <> p_request_fingerprint_sha256
       OR v_existing.preview_id <> p_preview_id
       OR v_existing.preview_fingerprint_sha256 <> p_preview_fingerprint_sha256
       OR v_existing.update_session_id <> p_update_session_id THEN
      RAISE EXCEPTION 'confirmed import cleanup idempotency conflict';
    END IF;
    RETURN QUERY SELECT 'existing'::text, v_existing.id,
      v_existing.pre_activation_cleanup_id, v_existing.file_count,
      v_existing.verified_object_count, v_existing.staged_batch_count;
    RETURN;
  END IF;

  SELECT
    activation.state AS activation_state,
    activation.queued_at AS activation_queued_at,
    activation.failure_reason AS activation_failure_reason,
    activation.failed_at AS activation_failed_at,
    activation.preview_fingerprint_sha256 AS activation_preview_fingerprint_sha256,
    activation.preview_dispatch_id,
    activation.idempotency_key AS activation_idempotency_key,
    prepared.preview_fingerprint_sha256 AS prepared_preview_fingerprint_sha256,
    prepared.upload_request_fingerprint_sha256,
    prepared.confirmable
  INTO STRICT v_context
  FROM dna.import_activation_dispatch activation
  JOIN dna.import_prepared_preview prepared
    ON prepared.owner_id = activation.owner_id
    AND prepared.preview_dispatch_id = activation.preview_dispatch_id
  WHERE activation.owner_id = p_owner_id
    AND activation.id = p_activation_dispatch_id
    AND activation.update_session_id = p_update_session_id
    AND prepared.upload_batch_id = p_upload_batch_id
    AND prepared.preview_id = p_preview_id
  FOR UPDATE OF activation, prepared;

  IF v_context.activation_state <> 'pending'
     OR v_context.activation_queued_at IS NOT NULL
     OR v_context.activation_failure_reason IS NOT NULL
     OR v_context.activation_failed_at IS NOT NULL THEN
    RAISE EXCEPTION 'confirmed import cleanup requires an undispatched pending reservation';
  END IF;
  IF v_context.activation_preview_fingerprint_sha256 <>
       p_preview_fingerprint_sha256
     OR v_context.prepared_preview_fingerprint_sha256 <>
       p_preview_fingerprint_sha256
     OR v_context.upload_request_fingerprint_sha256 <>
       p_request_fingerprint_sha256
     OR NOT v_context.confirmable THEN
    RAISE EXCEPTION 'confirmed import cleanup fingerprint or preview conflict';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM dna.import_activation_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.dispatch_id = p_activation_dispatch_id
  ) THEN
    RAISE EXCEPTION 'confirmed import cleanup cannot remove activation processing';
  END IF;

  DELETE FROM dna.import_activation_dispatch activation
  WHERE activation.owner_id = p_owner_id
    AND activation.id = p_activation_dispatch_id
    AND activation.update_session_id = p_update_session_id
    AND activation.state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending confirmed import reservation disappeared during cleanup';
  END IF;

  SELECT * INTO STRICT v_cleanup
  FROM dna.cleanup_import_before_activation(
    p_owner_id,
    p_upload_batch_id,
    p_request_fingerprint_sha256,
    btrim(p_reason),
    p_cleaned_at
  );

  IF v_cleanup.status NOT IN ('cleaned', 'existing')
     OR v_cleanup.cleanup_id IS NULL THEN
    RAISE EXCEPTION 'pre-activation cleanup did not produce a durable receipt';
  END IF;

  INSERT INTO dna.import_confirmation_cleanup (
    id, owner_id, upload_batch_id, request_fingerprint_sha256,
    preview_dispatch_id, preview_id, preview_fingerprint_sha256,
    update_session_id, activation_dispatch_id, activation_idempotency_key,
    pre_activation_cleanup_id, reason, file_count, verified_object_count,
    staged_batch_count, cleaned_at
  ) VALUES (
    v_confirmation_cleanup_id, p_owner_id, p_upload_batch_id,
    p_request_fingerprint_sha256, v_context.preview_dispatch_id,
    p_preview_id, p_preview_fingerprint_sha256, p_update_session_id,
    p_activation_dispatch_id, v_context.activation_idempotency_key,
    v_cleanup.cleanup_id, btrim(p_reason), v_cleanup.file_count,
    v_cleanup.verified_object_count, v_cleanup.staged_batch_count,
    p_cleaned_at
  );

  RETURN QUERY SELECT 'cleaned'::text, v_confirmation_cleanup_id,
    v_cleanup.cleanup_id, v_cleanup.file_count,
    v_cleanup.verified_object_count, v_cleanup.staged_batch_count;
END
$function$;

REVOKE ALL ON TABLE dna.import_confirmation_cleanup FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.cleanup_confirmed_import_before_dispatch(
  uuid, uuid, character, text, character, uuid, uuid, text, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.import_confirmation_cleanup TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.cleanup_confirmed_import_before_dispatch(
  uuid, uuid, character, text, character, uuid, uuid, text, timestamptz
) TO dna_app_runtime;

COMMIT;

BEGIN;

CREATE TABLE dna.import_preview_processing (
  owner_id uuid NOT NULL,
  preview_dispatch_id uuid NOT NULL,
  upload_batch_id uuid NOT NULL,
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  state text NOT NULL CHECK (state IN ('processing', 'failed', 'complete')),
  upload_request_fingerprint_sha256 character(64) NOT NULL CHECK (
    upload_request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  upload_manifest_fingerprint_sha256 character(64) NOT NULL CHECK (
    upload_manifest_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  failure_reason text CHECK (
    failure_reason IS NULL OR failure_reason = 'preview_processor_failed'
  ),
  failed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, preview_dispatch_id),
  FOREIGN KEY (owner_id, preview_dispatch_id)
    REFERENCES dna.import_preview_dispatch(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, upload_batch_id)
    REFERENCES dna.import_upload_batch(owner_id, id) ON DELETE CASCADE,
  CHECK (lease_expires_at > claimed_at),
  CHECK ((state = 'failed') = (failure_reason IS NOT NULL AND failed_at IS NOT NULL)),
  CHECK ((state = 'complete') = (completed_at IS NOT NULL))
);

CREATE TABLE dna.import_prepared_preview (
  owner_id uuid NOT NULL,
  preview_dispatch_id uuid NOT NULL,
  upload_batch_id uuid NOT NULL,
  preview_id text NOT NULL CHECK (
    preview_id = btrim(preview_id)
    AND preview_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  upload_request_fingerprint_sha256 character(64) NOT NULL CHECK (
    upload_request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  upload_manifest_fingerprint_sha256 character(64) NOT NULL CHECK (
    upload_manifest_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  preview_fingerprint_sha256 character(64) NOT NULL CHECK (
    preview_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  file_count integer NOT NULL CHECK (file_count BETWEEN 1 AND 24),
  source_family_count integer NOT NULL CHECK (source_family_count BETWEEN 1 AND 3),
  blocking_issue_count integer NOT NULL CHECK (blocking_issue_count >= 0),
  confirmable boolean NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, preview_dispatch_id),
  UNIQUE (owner_id, preview_id),
  FOREIGN KEY (owner_id, preview_dispatch_id)
    REFERENCES dna.import_preview_dispatch(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, upload_batch_id)
    REFERENCES dna.import_upload_batch(owner_id, id) ON DELETE CASCADE,
  CHECK (confirmable = (blocking_issue_count = 0))
);

CREATE INDEX import_preview_processing_lease
  ON dna.import_preview_processing(owner_id, state, lease_expires_at);
CREATE INDEX import_prepared_preview_recent
  ON dna.import_prepared_preview(owner_id, completed_at DESC);

ALTER TABLE dna.import_preview_processing ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_preview_processing FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.import_prepared_preview ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_prepared_preview FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.import_preview_processing
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.import_prepared_preview
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.claim_import_preview_dispatch(
  p_owner_id uuid,
  p_preview_dispatch_id uuid,
  p_worker_id text,
  p_upload_request_fingerprint_sha256 character(64),
  p_claimed_at timestamptz,
  p_lease_expires_at timestamptz
)
RETURNS TABLE (
  status text,
  authenticated_owner_id text,
  upload_batch_id uuid,
  upload_request_fingerprint_sha256 character(64),
  upload_manifest_fingerprint_sha256 character(64),
  retry_after timestamptz,
  preview_id text,
  preview_fingerprint_sha256 character(64),
  confirmable boolean,
  files jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_dispatch dna.import_preview_dispatch%ROWTYPE;
  v_processing dna.import_preview_processing%ROWTYPE;
  v_owner_clerk_id text;
  v_manifest character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped preview processing denied';
  END IF;
  IF p_lease_expires_at <= p_claimed_at THEN
    RAISE EXCEPTION 'preview processing lease is invalid';
  END IF;

  SELECT dispatch.* INTO v_dispatch
  FROM dna.import_preview_dispatch dispatch
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.id = p_preview_dispatch_id
    AND dispatch.state = 'queued'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid,
      NULL::character(64), NULL::character(64), NULL::timestamptz,
      NULL::text, NULL::character(64), NULL::boolean, '[]'::jsonb;
    RETURN;
  END IF;
  IF v_dispatch.upload_request_fingerprint_sha256 <>
      p_upload_request_fingerprint_sha256 THEN
    RAISE EXCEPTION 'preview processing fingerprint mismatch';
  END IF;

  RETURN QUERY
  SELECT 'already_complete'::text, owner.clerk_user_id, prepared.upload_batch_id,
    prepared.upload_request_fingerprint_sha256,
    prepared.upload_manifest_fingerprint_sha256, NULL::timestamptz,
    prepared.preview_id, prepared.preview_fingerprint_sha256,
    prepared.confirmable, '[]'::jsonb
  FROM dna.import_prepared_preview prepared
  JOIN dna.app_owner owner ON owner.id = prepared.owner_id
  WHERE prepared.owner_id = p_owner_id
    AND prepared.preview_dispatch_id = p_preview_dispatch_id;
  IF FOUND THEN RETURN; END IF;

  SELECT processing.* INTO v_processing
  FROM dna.import_preview_processing processing
  WHERE processing.owner_id = p_owner_id
    AND processing.preview_dispatch_id = p_preview_dispatch_id;

  IF FOUND
     AND v_processing.state = 'processing'
     AND v_processing.lease_expires_at > p_claimed_at
     AND v_processing.worker_id <> p_worker_id THEN
    RETURN QUERY SELECT 'leased_elsewhere'::text, NULL::text,
      v_processing.upload_batch_id,
      v_processing.upload_request_fingerprint_sha256,
      v_processing.upload_manifest_fingerprint_sha256,
      v_processing.lease_expires_at, NULL::text, NULL::character(64),
      NULL::boolean, '[]'::jsonb;
    RETURN;
  END IF;

  SELECT owner.clerk_user_id INTO STRICT v_owner_clerk_id
  FROM dna.app_owner owner WHERE owner.id = p_owner_id;

  SELECT encode(sha256(convert_to(string_agg(
      file.id::text || ':' || file.source_family || ':' ||
      file.byte_length::text || ':' || file.sha256::text,
      '|' ORDER BY file.id
    ), 'UTF8')), 'hex')::character(64)
  INTO v_manifest
  FROM dna.import_verified_upload_object verified
  JOIN dna.import_upload_file file
    ON file.owner_id = verified.owner_id
    AND file.id = verified.upload_file_id
  WHERE verified.owner_id = p_owner_id
    AND verified.preview_dispatch_id = p_preview_dispatch_id;

  IF v_manifest IS NULL THEN
    RAISE EXCEPTION 'verified preview manifest is unavailable';
  END IF;

  INSERT INTO dna.import_preview_processing (
    owner_id, preview_dispatch_id, upload_batch_id, worker_id, state,
    upload_request_fingerprint_sha256,
    upload_manifest_fingerprint_sha256,
    claimed_at, lease_expires_at
  ) VALUES (
    p_owner_id, p_preview_dispatch_id, v_dispatch.upload_batch_id,
    p_worker_id, 'processing', p_upload_request_fingerprint_sha256,
    v_manifest, p_claimed_at, p_lease_expires_at
  )
  ON CONFLICT (owner_id, preview_dispatch_id) DO UPDATE
  SET worker_id = EXCLUDED.worker_id,
      state = 'processing',
      upload_request_fingerprint_sha256 =
        EXCLUDED.upload_request_fingerprint_sha256,
      upload_manifest_fingerprint_sha256 =
        EXCLUDED.upload_manifest_fingerprint_sha256,
      claimed_at = EXCLUDED.claimed_at,
      lease_expires_at = EXCLUDED.lease_expires_at,
      failure_reason = NULL,
      failed_at = NULL,
      completed_at = NULL,
      updated_at = now();

  RETURN QUERY
  SELECT 'claimed'::text, v_owner_clerk_id, v_dispatch.upload_batch_id,
    p_upload_request_fingerprint_sha256, v_manifest, NULL::timestamptz,
    NULL::text, NULL::character(64), NULL::boolean,
    jsonb_agg(jsonb_build_object(
      'uploadFileId', file.id::text,
      'objectId', verified.object_id,
      'sourceFamily', file.source_family,
      'expectedByteLength', file.byte_length,
      'expectedSha256', file.sha256::text
    ) ORDER BY file.id)
  FROM dna.import_verified_upload_object verified
  JOIN dna.import_upload_file file
    ON file.owner_id = verified.owner_id
    AND file.id = verified.upload_file_id
  WHERE verified.owner_id = p_owner_id
    AND verified.preview_dispatch_id = p_preview_dispatch_id;
END
$function$;

CREATE FUNCTION dna.publish_import_prepared_preview(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_preview_dispatch_id uuid,
  p_upload_request_fingerprint_sha256 character(64),
  p_upload_manifest_fingerprint_sha256 character(64),
  p_preview_id text,
  p_preview_fingerprint_sha256 character(64),
  p_file_count integer,
  p_source_family_count integer,
  p_blocking_issue_count integer,
  p_confirmable boolean,
  p_completed_at timestamptz
)
RETURNS TABLE (
  disposition text,
  upload_request_fingerprint_sha256 character(64),
  upload_manifest_fingerprint_sha256 character(64),
  preview_id text,
  preview_fingerprint_sha256 character(64),
  confirmable boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped preview publication denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dna.import_preview_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.preview_dispatch_id = p_preview_dispatch_id
      AND processing.upload_batch_id = p_upload_batch_id
      AND processing.state = 'processing'
      AND processing.upload_request_fingerprint_sha256 =
        p_upload_request_fingerprint_sha256
      AND processing.upload_manifest_fingerprint_sha256 =
        p_upload_manifest_fingerprint_sha256
  ) THEN
    RAISE EXCEPTION 'preview processing claim is unavailable';
  END IF;

  INSERT INTO dna.import_prepared_preview (
    owner_id, preview_dispatch_id, upload_batch_id, preview_id,
    upload_request_fingerprint_sha256,
    upload_manifest_fingerprint_sha256,
    preview_fingerprint_sha256, file_count, source_family_count,
    blocking_issue_count, confirmable, completed_at
  ) VALUES (
    p_owner_id, p_preview_dispatch_id, p_upload_batch_id, p_preview_id,
    p_upload_request_fingerprint_sha256,
    p_upload_manifest_fingerprint_sha256,
    p_preview_fingerprint_sha256, p_file_count, p_source_family_count,
    p_blocking_issue_count, p_confirmable, p_completed_at
  )
  ON CONFLICT (owner_id, preview_dispatch_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF NOT EXISTS (
    SELECT 1 FROM dna.import_prepared_preview prepared
    WHERE prepared.owner_id = p_owner_id
      AND prepared.preview_dispatch_id = p_preview_dispatch_id
      AND prepared.upload_batch_id = p_upload_batch_id
      AND prepared.preview_id = p_preview_id
      AND prepared.upload_request_fingerprint_sha256 =
        p_upload_request_fingerprint_sha256
      AND prepared.upload_manifest_fingerprint_sha256 =
        p_upload_manifest_fingerprint_sha256
      AND prepared.preview_fingerprint_sha256 =
        p_preview_fingerprint_sha256
      AND prepared.file_count = p_file_count
      AND prepared.source_family_count = p_source_family_count
      AND prepared.blocking_issue_count = p_blocking_issue_count
      AND prepared.confirmable = p_confirmable
  ) THEN
    RAISE EXCEPTION 'prepared preview idempotency conflict';
  END IF;

  UPDATE dna.import_preview_processing processing
  SET state = 'complete', completed_at = p_completed_at,
      failure_reason = NULL, failed_at = NULL, updated_at = now()
  WHERE processing.owner_id = p_owner_id
    AND processing.preview_dispatch_id = p_preview_dispatch_id;

  RETURN QUERY
  SELECT CASE WHEN v_inserted = 1 THEN 'created' ELSE 'existing' END,
    prepared.upload_request_fingerprint_sha256,
    prepared.upload_manifest_fingerprint_sha256,
    prepared.preview_id, prepared.preview_fingerprint_sha256,
    prepared.confirmable
  FROM dna.import_prepared_preview prepared
  WHERE prepared.owner_id = p_owner_id
    AND prepared.preview_dispatch_id = p_preview_dispatch_id;
END
$function$;

CREATE FUNCTION dna.record_import_preview_processing_failure(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_preview_dispatch_id uuid,
  p_worker_id text,
  p_upload_request_fingerprint_sha256 character(64),
  p_failed_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped preview processing denied';
  END IF;
  UPDATE dna.import_preview_processing processing
  SET state = 'failed', failure_reason = 'preview_processor_failed',
      failed_at = p_failed_at, completed_at = NULL, updated_at = now()
  WHERE processing.owner_id = p_owner_id
    AND processing.upload_batch_id = p_upload_batch_id
    AND processing.preview_dispatch_id = p_preview_dispatch_id
    AND processing.worker_id = p_worker_id
    AND processing.upload_request_fingerprint_sha256 =
      p_upload_request_fingerprint_sha256
    AND processing.state = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'preview processing claim is unavailable'; END IF;
END
$function$;

REVOKE ALL ON TABLE dna.import_preview_processing FROM PUBLIC;
REVOKE ALL ON TABLE dna.import_prepared_preview FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.claim_import_preview_dispatch(
  uuid, uuid, text, character, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_import_prepared_preview(
  uuid, uuid, uuid, character, character, text, character,
  integer, integer, integer, boolean, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_import_preview_processing_failure(
  uuid, uuid, uuid, text, character, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.import_preview_processing TO dna_app_runtime;
GRANT SELECT ON TABLE dna.import_prepared_preview TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.claim_import_preview_dispatch(
  uuid, uuid, text, character, timestamptz, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_import_prepared_preview(
  uuid, uuid, uuid, character, character, text, character,
  integer, integer, integer, boolean, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_import_preview_processing_failure(
  uuid, uuid, uuid, text, character, timestamptz
) TO dna_app_runtime;

COMMIT;

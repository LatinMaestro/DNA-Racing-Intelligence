BEGIN;

CREATE TABLE dna.import_upload_completion (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  upload_batch_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    idempotency_key = btrim(idempotency_key)
    AND idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  upload_request_fingerprint_sha256 character(64) NOT NULL CHECK (
    upload_request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  state text NOT NULL DEFAULT 'claimed' CHECK (
    state IN ('claimed', 'verified', 'verification_failed')
  ),
  claimed_at timestamptz NOT NULL,
  verified_at timestamptz,
  failure_reason text CHECK (
    failure_reason IS NULL OR failure_reason IN (
      'object_store_unavailable',
      'object_metadata_mismatch',
      'private_scope_violation',
      'upload_target_expired'
    )
  ),
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, upload_batch_id, idempotency_key),
  FOREIGN KEY (owner_id, upload_batch_id)
    REFERENCES dna.import_upload_batch(owner_id, id) ON DELETE CASCADE,
  CHECK ((state = 'verified') = (verified_at IS NOT NULL)),
  CHECK (
    (state = 'verification_failed') =
      (failure_reason IS NOT NULL AND failed_at IS NOT NULL)
  )
);

CREATE TABLE dna.import_preview_dispatch (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  upload_batch_id uuid NOT NULL,
  completion_id uuid NOT NULL,
  upload_request_fingerprint_sha256 character(64) NOT NULL CHECK (
    upload_request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  state text NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'queued', 'failed')
  ),
  verified_at timestamptz NOT NULL,
  queued_at timestamptz,
  failure_reason text CHECK (
    failure_reason IS NULL OR failure_reason = 'preview_queue_unavailable'
  ),
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, upload_batch_id),
  UNIQUE (owner_id, completion_id),
  FOREIGN KEY (owner_id, upload_batch_id)
    REFERENCES dna.import_upload_batch(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, completion_id)
    REFERENCES dna.import_upload_completion(owner_id, id) ON DELETE CASCADE,
  CHECK ((state = 'queued') = (queued_at IS NOT NULL)),
  CHECK (
    (state = 'failed') =
      (failure_reason IS NOT NULL AND failed_at IS NOT NULL)
  )
);

CREATE TABLE dna.import_verified_upload_object (
  owner_id uuid NOT NULL,
  preview_dispatch_id uuid NOT NULL,
  upload_batch_id uuid NOT NULL,
  upload_file_id uuid NOT NULL,
  object_id text NOT NULL CHECK (
    object_id = btrim(object_id)
    AND object_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
    AND object_id = upload_file_id::text
  ),
  object_version text NOT NULL CHECK (
    object_version = btrim(object_version)
    AND length(object_version) BETWEEN 1 AND 512
    AND object_version !~ '[[:cntrl:]]'
  ),
  advertised_byte_length bigint NOT NULL CHECK (
    advertised_byte_length BETWEEN 1 AND 5368709120
  ),
  advertised_content_type text NOT NULL CHECK (
    advertised_content_type = btrim(advertised_content_type)
    AND length(advertised_content_type) BETWEEN 1 AND 255
    AND advertised_content_type !~ '[[:cntrl:]]'
  ),
  provider_sha256 character(64) CHECK (
    provider_sha256 IS NULL OR provider_sha256 ~ '^[a-f0-9]{64}$'
  ),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, preview_dispatch_id, upload_file_id),
  UNIQUE (owner_id, preview_dispatch_id, object_id),
  FOREIGN KEY (owner_id, preview_dispatch_id)
    REFERENCES dna.import_preview_dispatch(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, upload_file_id)
    REFERENCES dna.import_upload_file(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX import_upload_completion_recent
  ON dna.import_upload_completion(owner_id, claimed_at DESC);
CREATE INDEX import_preview_dispatch_state
  ON dna.import_preview_dispatch(owner_id, state, verified_at);

ALTER TABLE dna.import_upload_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_upload_completion FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.import_preview_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_preview_dispatch FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.import_verified_upload_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_verified_upload_object FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.import_upload_completion
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.import_preview_dispatch
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.import_verified_upload_object
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.claim_import_upload_completion(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_idempotency_key text,
  p_upload_request_fingerprint_sha256 character(64),
  p_claimed_at timestamptz
)
RETURNS TABLE (
  status text,
  completion_id uuid,
  upload_request_fingerprint_sha256 character(64),
  upload_target_expires_at timestamptz,
  preview_dispatch_id uuid,
  file_count integer,
  reserved_files jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch dna.import_upload_batch%ROWTYPE;
  v_completion_id uuid := md5(
    p_upload_batch_id::text || ':upload_completion:' || p_idempotency_key
  )::uuid;
  v_existing_fingerprint character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped upload completion denied';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_upload_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_upload_batch_id
    AND batch.state = 'targets_ready'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'not_found'::text, NULL::uuid, NULL::character(64),
      NULL::timestamptz, NULL::uuid, 0, '[]'::jsonb;
    RETURN;
  END IF;
  IF v_batch.request_fingerprint_sha256 <> p_upload_request_fingerprint_sha256 THEN
    RAISE EXCEPTION 'upload completion fingerprint mismatch';
  END IF;

  RETURN QUERY
  SELECT
    'already_queued'::text,
    dispatch.completion_id,
    dispatch.upload_request_fingerprint_sha256,
    v_batch.target_expires_at,
    dispatch.id,
    count(verified.upload_file_id)::integer,
    '[]'::jsonb
  FROM dna.import_preview_dispatch dispatch
  LEFT JOIN dna.import_verified_upload_object verified
    ON verified.owner_id = dispatch.owner_id
    AND verified.preview_dispatch_id = dispatch.id
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.upload_batch_id = p_upload_batch_id
    AND dispatch.state = 'queued'
  GROUP BY dispatch.id;

  IF FOUND THEN RETURN; END IF;

  INSERT INTO dna.import_upload_completion (
    id, owner_id, upload_batch_id, idempotency_key,
    upload_request_fingerprint_sha256, state, claimed_at
  ) VALUES (
    v_completion_id, p_owner_id, p_upload_batch_id, p_idempotency_key,
    p_upload_request_fingerprint_sha256, 'claimed', p_claimed_at
  )
  ON CONFLICT (owner_id, upload_batch_id, idempotency_key) DO UPDATE
  SET state = 'claimed',
      claimed_at = EXCLUDED.claimed_at,
      verified_at = NULL,
      failure_reason = NULL,
      failed_at = NULL,
      updated_at = now()
  WHERE dna.import_upload_completion.upload_request_fingerprint_sha256 =
    EXCLUDED.upload_request_fingerprint_sha256;

  SELECT completion.id, completion.upload_request_fingerprint_sha256
  INTO v_completion_id, v_existing_fingerprint
  FROM dna.import_upload_completion completion
  WHERE completion.owner_id = p_owner_id
    AND completion.upload_batch_id = p_upload_batch_id
    AND completion.idempotency_key = p_idempotency_key;

  IF v_existing_fingerprint IS NULL
     OR v_existing_fingerprint <> p_upload_request_fingerprint_sha256 THEN
    RAISE EXCEPTION 'upload completion idempotency conflict';
  END IF;

  RETURN QUERY
  SELECT
    'claimed'::text,
    v_completion_id,
    v_existing_fingerprint,
    v_batch.target_expires_at,
    NULL::uuid,
    count(file.id)::integer,
    COALESCE(jsonb_agg(jsonb_build_object(
      'uploadFileId', file.id::text,
      'objectId', file.id::text,
      'sourceFamily', file.source_family,
      'expectedByteLength', file.byte_length,
      'expectedSha256', file.sha256,
      'expectedContentType', file.content_type
    ) ORDER BY file.id), '[]'::jsonb)
  FROM dna.import_upload_file file
  WHERE file.owner_id = p_owner_id
    AND file.upload_batch_id = p_upload_batch_id;
END
$function$;

CREATE FUNCTION dna.reserve_import_preview_dispatch(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_completion_id uuid,
  p_upload_request_fingerprint_sha256 character(64),
  p_verified_at timestamptz,
  p_files jsonb
)
RETURNS TABLE (
  preview_dispatch_id uuid,
  disposition text,
  dispatch_state text,
  upload_request_fingerprint_sha256 character(64)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_dispatch_id uuid := md5(
    p_completion_id::text || ':import_preview_dispatch'
  )::uuid;
  v_inserted integer := 0;
  v_expected_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped preview dispatch denied';
  END IF;
  IF p_files IS NULL OR jsonb_typeof(p_files) <> 'array'
     OR jsonb_array_length(p_files) NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'verified upload object set is invalid';
  END IF;

  SELECT count(*)::integer INTO v_expected_count
  FROM dna.import_upload_file file
  WHERE file.owner_id = p_owner_id
    AND file.upload_batch_id = p_upload_batch_id;

  IF v_expected_count <> jsonb_array_length(p_files)
     OR v_expected_count <> (
       SELECT count(DISTINCT value->>'uploadFileId')
       FROM jsonb_array_elements(p_files)
     )
     OR v_expected_count <> (
       SELECT count(DISTINCT value->>'objectId')
       FROM jsonb_array_elements(p_files)
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_to_recordset(p_files) AS object(
         upload_file_id uuid,
         object_id text,
         object_version text,
         advertised_byte_length bigint,
         advertised_content_type text,
         provider_sha256 text,
         scope text,
         owner_id text,
         upload_batch_id text
       )
       WHERE object.upload_file_id IS NULL
         OR object.object_id IS NULL
         OR object.object_version IS NULL
         OR object.advertised_byte_length IS NULL
         OR object.advertised_content_type IS NULL
         OR object.scope <> 'private_owner'
         OR object.owner_id <> p_owner_id::text
         OR object.upload_batch_id <> p_upload_batch_id::text
         OR object.object_id <> object.upload_file_id::text
     ) THEN
    RAISE EXCEPTION 'verified upload object set is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_upload_completion completion
    WHERE completion.owner_id = p_owner_id
      AND completion.id = p_completion_id
      AND completion.upload_batch_id = p_upload_batch_id
      AND completion.upload_request_fingerprint_sha256 =
        p_upload_request_fingerprint_sha256
      AND completion.state IN ('claimed', 'verified')
  ) THEN
    RAISE EXCEPTION 'upload completion claim is unavailable';
  END IF;

  INSERT INTO dna.import_preview_dispatch (
    id, owner_id, upload_batch_id, completion_id,
    upload_request_fingerprint_sha256, state, verified_at
  ) VALUES (
    v_dispatch_id, p_owner_id, p_upload_batch_id, p_completion_id,
    p_upload_request_fingerprint_sha256, 'pending', p_verified_at
  )
  ON CONFLICT (owner_id, upload_batch_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT dispatch.id INTO v_dispatch_id
  FROM dna.import_preview_dispatch dispatch
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.upload_batch_id = p_upload_batch_id
    AND dispatch.completion_id = p_completion_id
    AND dispatch.upload_request_fingerprint_sha256 =
      p_upload_request_fingerprint_sha256;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preview dispatch idempotency conflict';
  END IF;

  IF v_inserted = 1 THEN
    INSERT INTO dna.import_verified_upload_object (
      owner_id, preview_dispatch_id, upload_batch_id, upload_file_id,
      object_id, object_version, advertised_byte_length,
      advertised_content_type, provider_sha256, verified_at
    )
    SELECT
      p_owner_id, v_dispatch_id, p_upload_batch_id,
      object.upload_file_id, object.object_id, object.object_version,
      object.advertised_byte_length, object.advertised_content_type,
      NULLIF(object.provider_sha256, '')::character(64), p_verified_at
    FROM jsonb_to_recordset(p_files) AS object(
      upload_file_id uuid,
      object_id text,
      object_version text,
      advertised_byte_length bigint,
      advertised_content_type text,
      provider_sha256 text,
      scope text,
      owner_id text,
      upload_batch_id text
    )
    JOIN dna.import_upload_file file
      ON file.owner_id = p_owner_id
      AND file.upload_batch_id = p_upload_batch_id
      AND file.id = object.upload_file_id
      AND file.byte_length = object.advertised_byte_length
      AND file.content_type = object.advertised_content_type
      AND (
        object.provider_sha256 IS NULL
        OR object.provider_sha256 = ''
        OR file.sha256 = object.provider_sha256::character(64)
      );

    IF (SELECT count(*) FROM dna.import_verified_upload_object verified
        WHERE verified.owner_id = p_owner_id
          AND verified.preview_dispatch_id = v_dispatch_id) <> v_expected_count THEN
      RAISE EXCEPTION 'verified upload metadata mismatch';
    END IF;
  ELSE
    IF EXISTS (
      (
        SELECT
          verified.upload_file_id::text,
          verified.object_id,
          verified.object_version,
          verified.advertised_byte_length,
          verified.advertised_content_type,
          COALESCE(verified.provider_sha256::text, '')
        FROM dna.import_verified_upload_object verified
        WHERE verified.owner_id = p_owner_id
          AND verified.preview_dispatch_id = v_dispatch_id
        EXCEPT
        SELECT
          object.upload_file_id::text,
          object.object_id,
          object.object_version,
          object.advertised_byte_length,
          object.advertised_content_type,
          COALESCE(object.provider_sha256, '')
        FROM jsonb_to_recordset(p_files) AS object(
          upload_file_id uuid,
          object_id text,
          object_version text,
          advertised_byte_length bigint,
          advertised_content_type text,
          provider_sha256 text
        )
      )
      UNION ALL
      (
        SELECT
          object.upload_file_id::text,
          object.object_id,
          object.object_version,
          object.advertised_byte_length,
          object.advertised_content_type,
          COALESCE(object.provider_sha256, '')
        FROM jsonb_to_recordset(p_files) AS object(
          upload_file_id uuid,
          object_id text,
          object_version text,
          advertised_byte_length bigint,
          advertised_content_type text,
          provider_sha256 text
        )
        EXCEPT
        SELECT
          verified.upload_file_id::text,
          verified.object_id,
          verified.object_version,
          verified.advertised_byte_length,
          verified.advertised_content_type,
          COALESCE(verified.provider_sha256::text, '')
        FROM dna.import_verified_upload_object verified
        WHERE verified.owner_id = p_owner_id
          AND verified.preview_dispatch_id = v_dispatch_id
      )
    ) THEN
      RAISE EXCEPTION 'verified upload replay mismatch';
    END IF;
  END IF;

  UPDATE dna.import_upload_completion completion
  SET state = 'verified', verified_at = p_verified_at,
      failure_reason = NULL, failed_at = NULL, updated_at = now()
  WHERE completion.owner_id = p_owner_id
    AND completion.id = p_completion_id;

  RETURN QUERY
  SELECT dispatch.id,
    CASE WHEN v_inserted = 1 THEN 'created' ELSE 'existing' END,
    dispatch.state,
    dispatch.upload_request_fingerprint_sha256
  FROM dna.import_preview_dispatch dispatch
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.id = v_dispatch_id;
END
$function$;

CREATE FUNCTION dna.mark_import_preview_dispatch_queued(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_preview_dispatch_id uuid,
  p_queued_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped preview dispatch denied';
  END IF;
  UPDATE dna.import_preview_dispatch dispatch
  SET state = 'queued', queued_at = p_queued_at,
      failure_reason = NULL, failed_at = NULL, updated_at = now()
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.upload_batch_id = p_upload_batch_id
    AND dispatch.id = p_preview_dispatch_id
    AND dispatch.state IN ('pending', 'queued', 'failed');
  IF NOT FOUND THEN RAISE EXCEPTION 'preview dispatch is unavailable'; END IF;
END
$function$;

CREATE FUNCTION dna.mark_import_preview_dispatch_failed(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_preview_dispatch_id uuid,
  p_failed_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped preview dispatch denied';
  END IF;
  UPDATE dna.import_preview_dispatch dispatch
  SET state = 'failed', queued_at = NULL,
      failure_reason = 'preview_queue_unavailable',
      failed_at = p_failed_at, updated_at = now()
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.upload_batch_id = p_upload_batch_id
    AND dispatch.id = p_preview_dispatch_id
    AND dispatch.state <> 'queued';
  IF NOT FOUND THEN RAISE EXCEPTION 'preview dispatch is unavailable'; END IF;
END
$function$;

CREATE FUNCTION dna.record_import_upload_verification_failure(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_completion_id uuid,
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
    RAISE EXCEPTION 'owner-scoped upload completion denied';
  END IF;
  IF p_reason NOT IN (
    'object_store_unavailable',
    'object_metadata_mismatch',
    'private_scope_violation',
    'upload_target_expired'
  ) THEN
    RAISE EXCEPTION 'upload verification failure reason is invalid';
  END IF;
  UPDATE dna.import_upload_completion completion
  SET state = 'verification_failed', verified_at = NULL,
      failure_reason = p_reason, failed_at = p_failed_at, updated_at = now()
  WHERE completion.owner_id = p_owner_id
    AND completion.upload_batch_id = p_upload_batch_id
    AND completion.id = p_completion_id
    AND NOT EXISTS (
      SELECT 1 FROM dna.import_preview_dispatch dispatch
      WHERE dispatch.owner_id = p_owner_id
        AND dispatch.completion_id = p_completion_id
        AND dispatch.state = 'queued'
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'upload completion claim is unavailable'; END IF;
END
$function$;

REVOKE ALL ON TABLE dna.import_upload_completion FROM PUBLIC;
REVOKE ALL ON TABLE dna.import_preview_dispatch FROM PUBLIC;
REVOKE ALL ON TABLE dna.import_verified_upload_object FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.claim_import_upload_completion(
  uuid, uuid, text, character, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.reserve_import_preview_dispatch(
  uuid, uuid, uuid, character, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.mark_import_preview_dispatch_queued(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.mark_import_preview_dispatch_failed(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_import_upload_verification_failure(
  uuid, uuid, uuid, timestamptz, text
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.import_upload_completion TO dna_app_runtime;
GRANT SELECT ON TABLE dna.import_preview_dispatch TO dna_app_runtime;
GRANT SELECT ON TABLE dna.import_verified_upload_object TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.claim_import_upload_completion(
  uuid, uuid, text, character, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.reserve_import_preview_dispatch(
  uuid, uuid, uuid, character, timestamptz, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.mark_import_preview_dispatch_queued(
  uuid, uuid, uuid, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.mark_import_preview_dispatch_failed(
  uuid, uuid, uuid, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_import_upload_verification_failure(
  uuid, uuid, uuid, timestamptz, text
) TO dna_app_runtime;

COMMIT;

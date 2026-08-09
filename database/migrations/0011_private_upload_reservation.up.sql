BEGIN;

CREATE TABLE dna.import_upload_batch (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (
    idempotency_key = btrim(idempotency_key)
    AND idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  request_fingerprint_sha256 character(64) NOT NULL CHECK (
    request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  state text NOT NULL DEFAULT 'reserved' CHECK (
    state IN ('reserved', 'targets_ready', 'failed')
  ),
  requested_at timestamptz NOT NULL,
  target_expires_at timestamptz,
  failure_reason text CHECK (
    failure_reason IS NULL OR failure_reason = 'private_object_target_unavailable'
  ),
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  CHECK (
    (state = 'targets_ready') = (target_expires_at IS NOT NULL)
  ),
  CHECK (
    (state = 'failed') = (failure_reason IS NOT NULL AND failed_at IS NOT NULL)
  )
);

CREATE TABLE dna.import_upload_file (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  upload_batch_id uuid NOT NULL,
  client_file_id text NOT NULL CHECK (
    client_file_id = btrim(client_file_id)
    AND client_file_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  source_family text NOT NULL CHECK (
    source_family IN ('race_merge', 'core_details', 'current_vault', 'current_arena')
  ),
  original_file_name text NOT NULL CHECK (
    original_file_name = btrim(original_file_name)
    AND length(original_file_name) BETWEEN 1 AND 255
    AND original_file_name !~ '[/\\]'
    AND lower(original_file_name) LIKE '%.csv'
  ),
  content_type text NOT NULL CHECK (
    content_type IN (
      'application/csv',
      'application/octet-stream',
      'application/vnd.ms-excel',
      'text/csv',
      'text/plain'
    )
  ),
  byte_length bigint NOT NULL CHECK (
    byte_length BETWEEN 1 AND 5368709120
  ),
  sha256 character(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, upload_batch_id, client_file_id),
  FOREIGN KEY (owner_id, upload_batch_id)
    REFERENCES dna.import_upload_batch(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX import_upload_batch_recent
  ON dna.import_upload_batch(owner_id, requested_at DESC);

ALTER TABLE dna.import_upload_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_upload_batch FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.import_upload_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_upload_file FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.import_upload_batch
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE POLICY owner_isolation ON dna.import_upload_file
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.reserve_import_upload_batch(
  p_owner_id uuid,
  p_idempotency_key text,
  p_request_fingerprint_sha256 character(64),
  p_requested_at timestamptz,
  p_files jsonb
)
RETURNS TABLE (
  disposition text,
  upload_batch_id uuid,
  request_fingerprint_sha256 character(64),
  reserved_files jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_upload_batch_id uuid := md5(
    p_owner_id::text || ':import_upload_batch:' || p_idempotency_key
  )::uuid;
  v_inserted_rows integer := 0;
  v_created boolean := false;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped import upload denied';
  END IF;
  IF
    p_files IS NULL
    OR jsonb_typeof(p_files) <> 'array'
    OR jsonb_array_length(p_files) NOT BETWEEN 1 AND 24
  THEN
    RAISE EXCEPTION 'import upload file set is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_files) AS file(
      client_file_id text,
      source_family text,
      original_file_name text,
      content_type text,
      byte_length bigint,
      sha256 text
    )
    WHERE
      file.client_file_id IS NULL
      OR file.source_family IS NULL
      OR file.original_file_name IS NULL
      OR file.content_type IS NULL
      OR file.byte_length IS NULL
      OR file.sha256 IS NULL
  ) OR (
    SELECT count(*)
    FROM jsonb_to_recordset(p_files) AS file(client_file_id text)
  ) <> (
    SELECT count(DISTINCT file.client_file_id)
    FROM jsonb_to_recordset(p_files) AS file(client_file_id text)
  ) THEN
    RAISE EXCEPTION 'import upload file identity set is invalid';
  END IF;

  INSERT INTO dna.import_upload_batch (
    id,
    owner_id,
    idempotency_key,
    request_fingerprint_sha256,
    requested_at
  ) VALUES (
    v_upload_batch_id,
    p_owner_id,
    p_idempotency_key,
    p_request_fingerprint_sha256,
    p_requested_at
  )
  ON CONFLICT (owner_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  v_created := v_inserted_rows = 1;

  IF v_created THEN
    INSERT INTO dna.import_upload_file (
      id,
      owner_id,
      upload_batch_id,
      client_file_id,
      source_family,
      original_file_name,
      content_type,
      byte_length,
      sha256
    )
    SELECT
      md5(v_upload_batch_id::text || ':file:' || file.client_file_id)::uuid,
      p_owner_id,
      v_upload_batch_id,
      file.client_file_id,
      file.source_family,
      file.original_file_name,
      file.content_type,
      file.byte_length,
      file.sha256::character(64)
    FROM jsonb_to_recordset(p_files) AS file(
      client_file_id text,
      source_family text,
      original_file_name text,
      content_type text,
      byte_length bigint,
      sha256 text
    );
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN v_created THEN 'created' ELSE 'existing' END,
    batch.id,
    batch.request_fingerprint_sha256,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'clientFileId', file.client_file_id,
          'uploadFileId', file.id::text
        ) ORDER BY file.client_file_id
      ),
      '[]'::jsonb
    )
  FROM dna.import_upload_batch batch
  LEFT JOIN dna.import_upload_file file
    ON file.owner_id = batch.owner_id
    AND file.upload_batch_id = batch.id
  WHERE
    batch.owner_id = p_owner_id
    AND batch.idempotency_key = p_idempotency_key
  GROUP BY batch.id, batch.request_fingerprint_sha256;
END
$function$;

CREATE FUNCTION dna.mark_import_upload_targets_ready(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_upload_file_ids uuid[],
  p_request_fingerprint_sha256 character(64),
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import upload denied';
  END IF;
  IF
    p_expires_at IS NULL
    OR p_upload_file_ids IS NULL
    OR p_expires_at <= now()
    OR cardinality(p_upload_file_ids) = 0
    OR cardinality(p_upload_file_ids) <> (
      SELECT count(*)
      FROM dna.import_upload_file file
      WHERE file.owner_id = p_owner_id AND file.upload_batch_id = p_upload_batch_id
    )
    OR cardinality(p_upload_file_ids) <> (
      SELECT count(DISTINCT file_id)
      FROM unnest(p_upload_file_ids) file_id
      JOIN dna.import_upload_file file
        ON file.owner_id = p_owner_id
        AND file.upload_batch_id = p_upload_batch_id
        AND file.id = file_id
    )
  THEN
    RAISE EXCEPTION 'import upload target file set is invalid';
  END IF;

  UPDATE dna.import_upload_batch batch
  SET state = 'targets_ready', target_expires_at = p_expires_at
  WHERE
    batch.owner_id = p_owner_id
    AND batch.id = p_upload_batch_id
    AND batch.request_fingerprint_sha256 = p_request_fingerprint_sha256
    AND batch.state IN ('reserved', 'targets_ready');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import upload reservation is unavailable';
  END IF;
END
$function$;

CREATE FUNCTION dna.mark_import_upload_reservation_failed(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_request_fingerprint_sha256 character(64),
  p_failed_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import upload denied';
  END IF;
  UPDATE dna.import_upload_batch batch
  SET
    state = 'failed',
    target_expires_at = NULL,
    failure_reason = 'private_object_target_unavailable',
    failed_at = p_failed_at
  WHERE
    batch.owner_id = p_owner_id
    AND batch.id = p_upload_batch_id
    AND batch.request_fingerprint_sha256 = p_request_fingerprint_sha256
    AND batch.state <> 'failed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import upload reservation is unavailable';
  END IF;
END
$function$;

REVOKE ALL ON TABLE dna.import_upload_batch FROM PUBLIC;
REVOKE ALL ON TABLE dna.import_upload_file FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.reserve_import_upload_batch(
  uuid, text, character, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.mark_import_upload_targets_ready(
  uuid, uuid, uuid[], character, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.mark_import_upload_reservation_failed(
  uuid, uuid, character, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.import_upload_batch TO dna_app_runtime;
GRANT SELECT ON TABLE dna.import_upload_file TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.reserve_import_upload_batch(
  uuid, text, character, timestamptz, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.mark_import_upload_targets_ready(
  uuid, uuid, uuid[], character, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.mark_import_upload_reservation_failed(
  uuid, uuid, character, timestamptz
) TO dna_app_runtime;

COMMIT;

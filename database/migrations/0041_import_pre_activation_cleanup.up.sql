BEGIN;

CREATE TABLE dna.import_pre_activation_cleanup (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  upload_batch_id uuid NOT NULL,
  request_fingerprint_sha256 character(64) NOT NULL CHECK (
    request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
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
  UNIQUE (owner_id, upload_batch_id)
);

ALTER TABLE dna.import_pre_activation_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_pre_activation_cleanup FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.import_pre_activation_cleanup
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.cleanup_import_before_activation(
  p_owner_id uuid,
  p_upload_batch_id uuid,
  p_request_fingerprint_sha256 character(64),
  p_reason text,
  p_cleaned_at timestamptz
)
RETURNS TABLE (
  status text,
  cleanup_id uuid,
  file_count integer,
  verified_object_count integer,
  staged_batch_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch dna.import_upload_batch%ROWTYPE;
  v_existing dna.import_pre_activation_cleanup%ROWTYPE;
  v_cleanup_id uuid := md5(
    p_owner_id::text || ':pre_activation_cleanup:' || p_upload_batch_id::text
  )::uuid;
  v_file_count integer;
  v_verified_object_count integer;
  v_staged_batch_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped pre-activation cleanup denied';
  END IF;
  IF p_cleaned_at IS NULL THEN
    RAISE EXCEPTION 'cleanup timestamp is required';
  END IF;
  IF p_reason IS NULL
     OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500
     OR btrim(p_reason) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'cleanup reason must contain between 10 and 500 printable characters';
  END IF;

  SELECT cleanup.* INTO v_existing
  FROM dna.import_pre_activation_cleanup cleanup
  WHERE cleanup.owner_id = p_owner_id
    AND cleanup.upload_batch_id = p_upload_batch_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint_sha256 <>
       p_request_fingerprint_sha256 THEN
      RAISE EXCEPTION 'pre-activation cleanup fingerprint conflict';
    END IF;
    RETURN QUERY SELECT 'existing'::text, v_existing.id,
      v_existing.file_count, v_existing.verified_object_count,
      v_existing.staged_batch_count;
    RETURN;
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_upload_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_upload_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid,
      0::integer, 0::integer, 0::integer;
    RETURN;
  END IF;
  IF v_batch.request_fingerprint_sha256 <>
     p_request_fingerprint_sha256 THEN
    RAISE EXCEPTION 'pre-activation cleanup fingerprint conflict';
  END IF;

  SELECT count(*)::integer
  INTO v_file_count
  FROM dna.import_upload_file file
  WHERE file.owner_id = p_owner_id
    AND file.upload_batch_id = p_upload_batch_id;

  IF v_file_count NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'pre-activation cleanup file count is invalid';
  END IF;

  PERFORM 1
  FROM dna.import_preview_dispatch dispatch
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.upload_batch_id = p_upload_batch_id
  FOR UPDATE;

  PERFORM 1
  FROM dna.import_preview_processing processing
  WHERE processing.owner_id = p_owner_id
    AND processing.upload_batch_id = p_upload_batch_id
  FOR UPDATE;

  PERFORM 1
  FROM dna.import_prepared_preview prepared
  WHERE prepared.owner_id = p_owner_id
    AND prepared.upload_batch_id = p_upload_batch_id
  FOR UPDATE;

  PERFORM 1
  FROM dna.import_activation_dispatch activation
  JOIN dna.import_prepared_preview prepared
    ON prepared.owner_id = activation.owner_id
    AND prepared.preview_dispatch_id = activation.preview_dispatch_id
  WHERE activation.owner_id = p_owner_id
    AND prepared.upload_batch_id = p_upload_batch_id
  FOR UPDATE OF activation;

  IF EXISTS (
    SELECT 1
    FROM dna.import_preview_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.upload_batch_id = p_upload_batch_id
      AND processing.state = 'processing'
  ) THEN
    RAISE EXCEPTION 'pre-activation cleanup cannot interrupt active processing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_activation_dispatch activation
    JOIN dna.import_prepared_preview prepared
      ON prepared.owner_id = activation.owner_id
      AND prepared.preview_dispatch_id = activation.preview_dispatch_id
    WHERE activation.owner_id = p_owner_id
      AND prepared.upload_batch_id = p_upload_batch_id
  ) THEN
    RAISE EXCEPTION 'confirmed import cannot use pre-activation cleanup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_upload_file file
    JOIN dna.import_batch batch
      ON batch.owner_id = file.owner_id
      AND batch.id = file.id
    WHERE file.owner_id = p_owner_id
      AND file.upload_batch_id = p_upload_batch_id
      AND batch.status IN ('accepted', 'rolled_back')
  ) OR EXISTS (
    SELECT 1
    FROM dna.import_upload_file file
    JOIN dna.dataset_version version
      ON version.owner_id = file.owner_id
      AND version.import_batch_id = file.id
    WHERE file.owner_id = p_owner_id
      AND file.upload_batch_id = p_upload_batch_id
  ) THEN
    RAISE EXCEPTION 'accepted import requires versioned rollback';
  END IF;

  SELECT count(*)::integer
  INTO v_verified_object_count
  FROM dna.import_verified_upload_object object
  WHERE object.owner_id = p_owner_id
    AND object.upload_batch_id = p_upload_batch_id;

  SELECT count(*)::integer
  INTO v_staged_batch_count
  FROM dna.import_upload_file file
  JOIN dna.import_batch batch
    ON batch.owner_id = file.owner_id
    AND batch.id = file.id
  WHERE file.owner_id = p_owner_id
    AND file.upload_batch_id = p_upload_batch_id;

  DELETE FROM dna.import_batch batch
  USING dna.import_upload_file file
  WHERE file.owner_id = p_owner_id
    AND file.upload_batch_id = p_upload_batch_id
    AND batch.owner_id = file.owner_id
    AND batch.id = file.id
    AND batch.status IN ('uploaded', 'validating', 'quarantined');

  INSERT INTO dna.import_pre_activation_cleanup (
    id, owner_id, upload_batch_id, request_fingerprint_sha256,
    reason, file_count, verified_object_count, staged_batch_count, cleaned_at
  ) VALUES (
    v_cleanup_id, p_owner_id, p_upload_batch_id,
    p_request_fingerprint_sha256, btrim(p_reason), v_file_count,
    v_verified_object_count, v_staged_batch_count, p_cleaned_at
  );

  DELETE FROM dna.import_upload_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_upload_batch_id
    AND batch.request_fingerprint_sha256 =
      p_request_fingerprint_sha256;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pre-activation upload batch disappeared during cleanup';
  END IF;

  RETURN QUERY SELECT 'cleaned'::text, v_cleanup_id,
    v_file_count, v_verified_object_count, v_staged_batch_count;
END
$function$;

REVOKE ALL ON TABLE dna.import_pre_activation_cleanup FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.cleanup_import_before_activation(
  uuid, uuid, character, text, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.import_pre_activation_cleanup TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.cleanup_import_before_activation(
  uuid, uuid, character, text, timestamptz
) TO dna_app_runtime;

COMMIT;

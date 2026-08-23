BEGIN;

CREATE FUNCTION dna.cleanup_unlinked_dataset_evidence_batch(
  p_owner_id uuid,
  p_import_batch_id uuid,
  p_checksum_sha256 character(64)
)
RETURNS TABLE (
  status text,
  deleted_manifest_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch dna.import_batch%ROWTYPE;
  v_manifest_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped evidence batch cleanup denied';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 0::integer;
    RETURN;
  END IF;
  IF v_batch.checksum_sha256 <> p_checksum_sha256 THEN
    RAISE EXCEPTION 'evidence batch cleanup checksum conflict';
  END IF;
  IF v_batch.status NOT IN ('uploaded', 'validating', 'quarantined') THEN
    RAISE EXCEPTION 'accepted evidence batch requires versioned rollback';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM dna.dataset_version version
    WHERE version.owner_id = p_owner_id
      AND version.import_batch_id = p_import_batch_id
  ) THEN
    RAISE EXCEPTION 'versioned evidence batch requires versioned rollback';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM dna.import_upload_file file
    WHERE file.owner_id = p_owner_id
      AND file.id = p_import_batch_id
  ) THEN
    RAISE EXCEPTION 'upload-linked evidence batch requires import cleanup';
  END IF;

  SELECT count(*)::integer INTO v_manifest_count
  FROM dna.dataset_evidence_object object
  WHERE object.owner_id = p_owner_id
    AND object.import_batch_id = p_import_batch_id;

  DELETE FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
    AND batch.checksum_sha256 = p_checksum_sha256
    AND batch.status IN ('uploaded', 'validating', 'quarantined');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence batch changed during cleanup';
  END IF;

  RETURN QUERY SELECT 'cleaned'::text, v_manifest_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.cleanup_unlinked_dataset_evidence_batch(
  uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.cleanup_unlinked_dataset_evidence_batch(
  uuid, uuid, character
) TO dna_app_runtime;

COMMIT;

BEGIN;

CREATE FUNCTION dna.compact_import_activation_dataset_evidence(
  p_owner_id uuid,
  p_update_session_id uuid,
  p_dispatch_id uuid,
  p_compacted_at timestamptz,
  p_maximum_source_versions integer
)
RETURNS TABLE (
  status text,
  source_version_count integer,
  deleted_staged_record_count bigint,
  deleted_contribution_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_preview_dispatch_id uuid;
  v_source_version_count integer;
  v_existing_count integer := 0;
  v_deleted_staged bigint := 0;
  v_deleted_contributions bigint := 0;
  v_batch record;
  v_compaction record;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped activation evidence compaction denied';
  END IF;
  IF p_compacted_at IS NULL THEN
    RAISE EXCEPTION 'activation evidence compaction timestamp is required';
  END IF;
  IF p_maximum_source_versions < 1 OR p_maximum_source_versions > 24 THEN
    RAISE EXCEPTION 'activation evidence compaction bound is invalid';
  END IF;

  SELECT dispatch.preview_dispatch_id
  INTO v_preview_dispatch_id
  FROM dna.import_activation_processing processing
  JOIN dna.import_activation_dispatch dispatch
    ON dispatch.owner_id = processing.owner_id
    AND dispatch.id = processing.dispatch_id
    AND dispatch.update_session_id = processing.update_session_id
  WHERE processing.owner_id = p_owner_id
    AND processing.update_session_id = p_update_session_id
    AND processing.dispatch_id = p_dispatch_id
    AND processing.state = 'processing'
  FOR UPDATE OF processing, dispatch;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing activation is unavailable for evidence compaction';
  END IF;

  SELECT count(DISTINCT object.upload_file_id)::integer
  INTO v_source_version_count
  FROM dna.import_verified_upload_object object
  JOIN dna.import_batch batch
    ON batch.owner_id = object.owner_id
    AND batch.id = object.upload_file_id
    AND batch.status = 'accepted'
  WHERE object.owner_id = p_owner_id
    AND object.preview_dispatch_id = v_preview_dispatch_id;

  IF v_source_version_count < 1
     OR v_source_version_count > p_maximum_source_versions THEN
    RAISE EXCEPTION 'accepted activation evidence count is invalid';
  END IF;

  FOR v_batch IN
    SELECT DISTINCT batch.id, batch.source_type
    FROM dna.import_verified_upload_object object
    JOIN dna.import_batch batch
      ON batch.owner_id = object.owner_id
      AND batch.id = object.upload_file_id
      AND batch.status = 'accepted'
    WHERE object.owner_id = p_owner_id
      AND object.preview_dispatch_id = v_preview_dispatch_id
    ORDER BY batch.source_type, batch.id
  LOOP
    SELECT * INTO STRICT v_compaction
    FROM dna.compact_accepted_dataset_evidence(
      p_owner_id, v_batch.id, p_compacted_at
    );
    IF v_compaction.status = 'existing' THEN
      v_existing_count := v_existing_count + 1;
    ELSIF v_compaction.status <> 'compacted' THEN
      RAISE EXCEPTION 'accepted activation evidence compaction result is invalid';
    END IF;
    v_deleted_staged :=
      v_deleted_staged + v_compaction.deleted_staged_record_count;
    v_deleted_contributions :=
      v_deleted_contributions + v_compaction.deleted_contribution_count;
  END LOOP;

  RETURN QUERY SELECT
    CASE WHEN v_existing_count = v_source_version_count
      THEN 'existing'::text ELSE 'compacted'::text END,
    v_source_version_count,
    v_deleted_staged,
    v_deleted_contributions;
END
$function$;

REVOKE ALL ON FUNCTION dna.compact_import_activation_dataset_evidence(
  uuid, uuid, uuid, timestamptz, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.compact_import_activation_dataset_evidence(
  uuid, uuid, uuid, timestamptz, integer
) TO dna_app_runtime;

COMMIT;

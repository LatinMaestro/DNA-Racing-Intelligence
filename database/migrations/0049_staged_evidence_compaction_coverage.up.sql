BEGIN;

CREATE OR REPLACE FUNCTION dna.compact_accepted_dataset_evidence(
  p_owner_id uuid,
  p_import_batch_id uuid,
  p_compacted_at timestamptz
)
RETURNS TABLE (
  status text,
  deleted_staged_record_count bigint,
  deleted_contribution_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch dna.import_batch%ROWTYPE;
  v_receipt dna.dataset_evidence_compaction_receipt%ROWTYPE;
  v_staged_manifest_count integer;
  v_staged_evidence_rows bigint;
  v_normalized_manifest_count integer;
  v_normalized_evidence_rows bigint;
  v_evidence_rows bigint;
  v_evidence_kind text;
  v_deleted_staged bigint;
  v_deleted_contributions bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped accepted evidence compaction denied';
  END IF;
  IF p_compacted_at IS NULL THEN
    RAISE EXCEPTION 'accepted evidence compaction timestamp is required';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM dna.dataset_evidence_compaction_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = p_import_batch_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT 'existing'::text,
      v_receipt.deleted_staged_record_count,
      v_receipt.deleted_contribution_count;
    RETURN;
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped accepted import batch does not exist';
  END IF;
  IF v_batch.status <> 'accepted' THEN
    RAISE EXCEPTION 'only an accepted import batch can be compacted';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version version
    JOIN dna.aggregate_refresh_job refresh
      ON refresh.owner_id = version.owner_id
      AND refresh.dataset_version_id = version.id
      AND refresh.status IN ('queued', 'running', 'completed')
    WHERE version.owner_id = p_owner_id
      AND version.import_batch_id = p_import_batch_id
      AND version.rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'accepted dataset materialization evidence is incomplete';
  END IF;

  SELECT
    count(*) FILTER (WHERE object.object_kind = 'staged_rows')::integer,
    COALESCE(sum(object.row_count) FILTER (
      WHERE object.object_kind = 'staged_rows'
    ), 0),
    count(*) FILTER (
      WHERE object.object_kind = 'normalized_partition'
    )::integer,
    COALESCE(sum(object.row_count) FILTER (
      WHERE object.object_kind = 'normalized_partition'
    ), 0)
  INTO v_staged_manifest_count, v_staged_evidence_rows,
    v_normalized_manifest_count, v_normalized_evidence_rows
  FROM dna.dataset_evidence_object object
  WHERE object.owner_id = p_owner_id
    AND object.import_batch_id = p_import_batch_id
    AND object.source_type = v_batch.source_type
    AND object.object_kind IN ('staged_rows', 'normalized_partition');

  IF v_staged_manifest_count > 0 AND v_normalized_manifest_count > 0 THEN
    RAISE EXCEPTION 'accepted evidence coverage is ambiguous';
  ELSIF v_staged_manifest_count > 0 THEN
    v_evidence_rows := v_staged_evidence_rows;
    v_evidence_kind := 'staged_rows';
  ELSIF v_normalized_manifest_count > 0 THEN
    v_evidence_rows := v_normalized_evidence_rows;
    v_evidence_kind := 'normalized_partition';
  ELSE
    RAISE EXCEPTION 'accepted evidence coverage is unavailable';
  END IF;

  IF v_evidence_rows <> v_batch.source_rows THEN
    IF v_evidence_kind = 'normalized_partition' THEN
      RAISE EXCEPTION 'normalized evidence coverage does not match accepted source rows';
    END IF;
    RAISE EXCEPTION 'accepted evidence coverage does not match source rows';
  END IF;

  WITH deleted AS (
    DELETE FROM dna.dataset_record_contribution contribution
    WHERE contribution.owner_id = p_owner_id
      AND contribution.import_batch_id = p_import_batch_id
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_contributions FROM deleted;

  WITH deleted AS (
    DELETE FROM dna.dataset_staged_record staged
    WHERE staged.owner_id = p_owner_id
      AND staged.import_batch_id = p_import_batch_id
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_staged FROM deleted;

  INSERT INTO dna.dataset_evidence_compaction_receipt (
    owner_id, import_batch_id, source_type, source_row_count,
    evidence_row_count, deleted_staged_record_count,
    deleted_contribution_count, compacted_at
  ) VALUES (
    p_owner_id, p_import_batch_id, v_batch.source_type, v_batch.source_rows,
    v_evidence_rows, v_deleted_staged, v_deleted_contributions, p_compacted_at
  );

  RETURN QUERY SELECT 'compacted'::text,
    v_deleted_staged, v_deleted_contributions;
END
$function$;

COMMIT;

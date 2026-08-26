BEGIN;

CREATE FUNCTION dna.list_import_preview_race_evidence_manifest(
  p_owner_id uuid,
  p_import_batch_id uuid,
  p_maximum_partitions integer
)
RETURNS TABLE (
  import_batch_id uuid,
  source_type text,
  evidence_kind text,
  evidence_partition_count integer,
  evidence_row_count bigint,
  evidence_byte_size bigint,
  partition_number integer,
  object_format text,
  object_key text,
  checksum_sha256 character(64),
  byte_size bigint,
  row_count bigint,
  first_natural_key text,
  last_natural_key text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch dna.import_batch%ROWTYPE;
  v_partition_count integer;
  v_registered_count integer;
  v_evidence_row_count bigint;
  v_evidence_byte_size bigint;
  v_min_partition integer;
  v_max_partition integer;
  v_exact_object_count integer;
  v_total_object_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Preview Race evidence manifest denied';
  END IF;
  IF p_maximum_partitions IS NULL
     OR p_maximum_partitions NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Preview Race evidence partition bound is invalid';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
  FOR SHARE;

  IF NOT FOUND OR v_batch.source_type <> 'race_merge' THEN
    RAISE EXCEPTION 'owner-scoped Preview Race import batch is unavailable';
  END IF;
  IF v_batch.status NOT IN ('validating', 'accepted')
     OR v_batch.source_rows <= 0
     OR v_batch.accepted_rows <= 0
     OR v_batch.accepted_rows + v_batch.rejected_rows <> v_batch.source_rows THEN
    RAISE EXCEPTION 'Preview Race import batch counts are not finalized';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_evidence_object object
    WHERE object.owner_id = p_owner_id
      AND object.import_batch_id = p_import_batch_id
      AND object.source_type = 'race_merge'
      AND object.object_kind <> 'staged_rows'
  ) THEN
    RAISE EXCEPTION 'Preview Race evidence authority is ambiguous';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE receipt.registered_at IS NOT NULL)::integer,
    COALESCE(sum(receipt.row_count), 0)::bigint,
    COALESCE(sum(receipt.byte_size), 0)::bigint,
    min(receipt.partition_number),
    max(receipt.partition_number)
  INTO
    v_partition_count,
    v_registered_count,
    v_evidence_row_count,
    v_evidence_byte_size,
    v_min_partition,
    v_max_partition
  FROM dna.import_preview_evidence_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = p_import_batch_id
    AND receipt.source_type = 'race_merge'
    AND receipt.object_kind = 'staged_rows';

  IF v_partition_count NOT BETWEEN 1 AND p_maximum_partitions
     OR v_registered_count <> v_partition_count
     OR v_min_partition <> 0
     OR v_max_partition <> v_partition_count - 1
     OR v_evidence_row_count <> v_batch.source_rows
     OR v_evidence_byte_size <= 0 THEN
    RAISE EXCEPTION 'complete finalized Preview Race evidence is unavailable';
  END IF;

  SELECT count(*)::integer
  INTO v_total_object_count
  FROM dna.dataset_evidence_object object
  WHERE object.owner_id = p_owner_id
    AND object.import_batch_id = p_import_batch_id
    AND object.source_type = 'race_merge'
    AND object.object_kind = 'staged_rows';

  SELECT count(*)::integer
  INTO v_exact_object_count
  FROM dna.import_preview_evidence_receipt receipt
  JOIN dna.dataset_evidence_object object
    ON object.owner_id = receipt.owner_id
    AND object.import_batch_id = receipt.import_batch_id
    AND object.source_type = receipt.source_type
    AND object.object_kind = receipt.object_kind
    AND object.partition_number = receipt.partition_number
    AND object.object_format = receipt.object_format
    AND object.object_key = receipt.object_key
    AND object.checksum_sha256 = receipt.checksum_sha256
    AND object.byte_size = receipt.byte_size
    AND object.row_count = receipt.row_count
    AND object.first_natural_key IS NOT DISTINCT FROM receipt.first_natural_key
    AND object.last_natural_key IS NOT DISTINCT FROM receipt.last_natural_key
    AND object.created_at = receipt.object_created_at
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = p_import_batch_id
    AND receipt.source_type = 'race_merge'
    AND receipt.object_kind = 'staged_rows'
    AND receipt.registered_at IS NOT NULL;

  IF v_total_object_count <> v_partition_count
     OR v_exact_object_count <> v_partition_count THEN
    RAISE EXCEPTION 'Preview Race evidence manifest replay conflict';
  END IF;

  RETURN QUERY
  SELECT
    p_import_batch_id,
    'race_merge'::text,
    'staged_rows'::text,
    v_partition_count,
    v_evidence_row_count,
    v_evidence_byte_size,
    object.partition_number,
    object.object_format,
    object.object_key,
    object.checksum_sha256,
    object.byte_size,
    object.row_count,
    object.first_natural_key,
    object.last_natural_key,
    object.created_at
  FROM dna.import_preview_evidence_receipt receipt
  JOIN dna.dataset_evidence_object object
    ON object.owner_id = receipt.owner_id
    AND object.import_batch_id = receipt.import_batch_id
    AND object.source_type = receipt.source_type
    AND object.object_kind = receipt.object_kind
    AND object.partition_number = receipt.partition_number
    AND object.object_format = receipt.object_format
    AND object.object_key = receipt.object_key
    AND object.checksum_sha256 = receipt.checksum_sha256
    AND object.byte_size = receipt.byte_size
    AND object.row_count = receipt.row_count
    AND object.first_natural_key IS NOT DISTINCT FROM receipt.first_natural_key
    AND object.last_natural_key IS NOT DISTINCT FROM receipt.last_natural_key
    AND object.created_at = receipt.object_created_at
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = p_import_batch_id
    AND receipt.source_type = 'race_merge'
    AND receipt.object_kind = 'staged_rows'
    AND receipt.registered_at IS NOT NULL
  ORDER BY object.partition_number;
END
$function$;

REVOKE ALL ON FUNCTION dna.list_import_preview_race_evidence_manifest(
  uuid, uuid, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_import_preview_race_evidence_manifest(
  uuid, uuid, integer
) TO dna_app_runtime;

COMMIT;

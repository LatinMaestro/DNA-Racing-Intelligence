BEGIN;

CREATE TABLE dna.dataset_version_evidence_receipt (
  owner_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_arena')
  ),
  evidence_kind text NOT NULL CHECK (
    evidence_kind IN ('staged_rows', 'normalized_partition')
  ),
  evidence_partition_count integer NOT NULL CHECK (
    evidence_partition_count BETWEEN 1 AND 10000
  ),
  evidence_row_count bigint NOT NULL CHECK (evidence_row_count > 0),
  evidence_byte_size bigint NOT NULL CHECK (evidence_byte_size > 0),
  sealed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, dataset_version_id),
  UNIQUE (owner_id, import_batch_id),
  FOREIGN KEY (owner_id, dataset_version_id, source_type)
    REFERENCES dna.dataset_version(owner_id, id, source_type)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_id, import_batch_id, source_type)
    REFERENCES dna.import_batch(owner_id, id, source_type)
    ON DELETE CASCADE
);

ALTER TABLE dna.dataset_version_evidence_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dataset_version_evidence_receipt FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.dataset_version_evidence_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.seal_dataset_version_evidence(
  p_owner_id uuid,
  p_dataset_version_id uuid,
  p_sealed_at timestamptz
)
RETURNS TABLE (
  status text,
  evidence_kind text,
  evidence_partition_count integer,
  evidence_row_count bigint,
  evidence_byte_size bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_version dna.dataset_version%ROWTYPE;
  v_batch dna.import_batch%ROWTYPE;
  v_receipt dna.dataset_version_evidence_receipt%ROWTYPE;
  v_staged_partition_count integer;
  v_staged_row_count bigint;
  v_staged_byte_size bigint;
  v_normalized_partition_count integer;
  v_normalized_row_count bigint;
  v_normalized_byte_size bigint;
  v_evidence_kind text;
  v_partition_count integer;
  v_row_count bigint;
  v_byte_size bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped dataset version evidence sealing denied';
  END IF;
  IF p_sealed_at IS NULL THEN
    RAISE EXCEPTION 'dataset version evidence sealing timestamp is required';
  END IF;

  SELECT version.* INTO v_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped dataset version does not exist';
  END IF;
  IF v_version.source_type NOT IN ('race_merge', 'core_details', 'current_arena') THEN
    RAISE EXCEPTION 'dataset version source does not support private evidence sealing';
  END IF;
  IF v_version.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'rolled-back dataset version cannot be sealed';
  END IF;
  IF v_version.aggregate_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'dataset version analytical read models are not refreshed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_job job
    WHERE job.owner_id = p_owner_id
      AND job.dataset_version_id = p_dataset_version_id
      AND job.status = 'completed'
      AND job.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'dataset version aggregate refresh is not complete';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = v_version.import_batch_id
    AND batch.source_type = v_version.source_type
  FOR UPDATE;

  IF NOT FOUND OR v_batch.status <> 'accepted' THEN
    RAISE EXCEPTION 'accepted owner-scoped import batch is unavailable';
  END IF;
  IF v_batch.source_rows <= 0 THEN
    RAISE EXCEPTION 'dataset version evidence requires a non-empty source batch';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM dna.dataset_version_evidence_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.dataset_version_id = p_dataset_version_id
  FOR UPDATE;

  SELECT
    count(*) FILTER (WHERE object.object_kind = 'staged_rows')::integer,
    COALESCE(sum(object.row_count) FILTER (
      WHERE object.object_kind = 'staged_rows'
    ), 0)::bigint,
    COALESCE(sum(object.byte_size) FILTER (
      WHERE object.object_kind = 'staged_rows'
    ), 0)::bigint,
    count(*) FILTER (
      WHERE object.object_kind = 'normalized_partition'
    )::integer,
    COALESCE(sum(object.row_count) FILTER (
      WHERE object.object_kind = 'normalized_partition'
    ), 0)::bigint,
    COALESCE(sum(object.byte_size) FILTER (
      WHERE object.object_kind = 'normalized_partition'
    ), 0)::bigint
  INTO
    v_staged_partition_count,
    v_staged_row_count,
    v_staged_byte_size,
    v_normalized_partition_count,
    v_normalized_row_count,
    v_normalized_byte_size
  FROM dna.dataset_evidence_object object
  WHERE object.owner_id = p_owner_id
    AND object.import_batch_id = v_batch.id
    AND object.source_type = v_batch.source_type
    AND object.object_kind IN ('staged_rows', 'normalized_partition');

  IF v_staged_partition_count > 0 AND v_normalized_partition_count > 0 THEN
    RAISE EXCEPTION 'dataset version evidence coverage is ambiguous';
  ELSIF v_normalized_partition_count > 0 THEN
    v_evidence_kind := 'normalized_partition';
    v_partition_count := v_normalized_partition_count;
    v_row_count := v_normalized_row_count;
    v_byte_size := v_normalized_byte_size;
  ELSIF v_staged_partition_count > 0 THEN
    v_evidence_kind := 'staged_rows';
    v_partition_count := v_staged_partition_count;
    v_row_count := v_staged_row_count;
    v_byte_size := v_staged_byte_size;
  ELSE
    RAISE EXCEPTION 'dataset version evidence coverage is unavailable';
  END IF;

  IF v_partition_count NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'dataset version evidence partition count is invalid';
  END IF;
  IF v_row_count <> v_batch.source_rows THEN
    RAISE EXCEPTION 'dataset version evidence coverage does not match source rows';
  END IF;
  IF v_byte_size <= 0 THEN
    RAISE EXCEPTION 'dataset version evidence byte size is invalid';
  END IF;

  IF v_receipt.dataset_version_id IS NOT NULL THEN
    IF v_receipt.import_batch_id <> v_batch.id
       OR v_receipt.source_type <> v_batch.source_type
       OR v_receipt.evidence_kind <> v_evidence_kind
       OR v_receipt.evidence_partition_count <> v_partition_count
       OR v_receipt.evidence_row_count <> v_row_count
       OR v_receipt.evidence_byte_size <> v_byte_size THEN
      RAISE EXCEPTION 'dataset version evidence receipt replay conflict';
    END IF;

    RETURN QUERY SELECT
      'existing'::text,
      v_receipt.evidence_kind,
      v_receipt.evidence_partition_count,
      v_receipt.evidence_row_count,
      v_receipt.evidence_byte_size;
    RETURN;
  END IF;

  INSERT INTO dna.dataset_version_evidence_receipt (
    owner_id,
    dataset_version_id,
    import_batch_id,
    source_type,
    evidence_kind,
    evidence_partition_count,
    evidence_row_count,
    evidence_byte_size,
    sealed_at
  ) VALUES (
    p_owner_id,
    p_dataset_version_id,
    v_batch.id,
    v_batch.source_type,
    v_evidence_kind,
    v_partition_count,
    v_row_count,
    v_byte_size,
    p_sealed_at
  );

  RETURN QUERY SELECT
    'sealed'::text,
    v_evidence_kind,
    v_partition_count,
    v_row_count,
    v_byte_size;
END
$function$;

REVOKE ALL ON TABLE dna.dataset_version_evidence_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.dataset_version_evidence_receipt TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) TO dna_app_runtime;

COMMIT;

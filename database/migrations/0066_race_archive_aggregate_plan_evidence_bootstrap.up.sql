BEGIN;

CREATE FUNCTION dna.bootstrap_race_archive_aggregate_evidence_receipts(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_source_version_set_sha256 character(64)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_target_version dna.dataset_version%ROWTYPE;
  v_inserted_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive evidence bootstrap denied';
  END IF;
  IF p_source_version_set_sha256 IS NULL
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive evidence bootstrap source-version checksum is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = p_dataset_version_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = p_source_version_set_sha256
  ) THEN
    RAISE EXCEPTION 'Race archive evidence bootstrap refresh claim is unavailable';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive evidence bootstrap source versions were superseded';
  END IF;

  SELECT version.* INTO v_target_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active Race Merge evidence-bootstrap target is unavailable';
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
  )
  SELECT
    version.owner_id,
    version.id,
    version.import_batch_id,
    'race_merge'::text,
    'staged_rows'::text,
    count(object.partition_number)::integer,
    sum(object.row_count)::bigint,
    sum(object.byte_size)::bigint,
    now()
  FROM dna.dataset_version version
  JOIN dna.import_batch batch
    ON batch.owner_id = version.owner_id
    AND batch.id = version.import_batch_id
    AND batch.source_type = 'race_merge'
    AND batch.status = 'accepted'
  JOIN dna.dataset_evidence_object object
    ON object.owner_id = version.owner_id
    AND object.import_batch_id = version.import_batch_id
    AND object.source_type = 'race_merge'
    AND object.object_kind = 'staged_rows'
  LEFT JOIN dna.dataset_version_evidence_receipt receipt
    ON receipt.owner_id = version.owner_id
    AND receipt.dataset_version_id = version.id
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= v_target_version.version_number
    AND receipt.dataset_version_id IS NULL
  GROUP BY
    version.owner_id,
    version.id,
    version.import_batch_id,
    batch.source_rows
  HAVING count(object.partition_number) BETWEEN 1 AND 10000
    AND count(DISTINCT object.partition_number) = count(object.partition_number)
    AND sum(object.row_count) = batch.source_rows
    AND sum(object.byte_size) > 0
  ON CONFLICT (owner_id, dataset_version_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_version version
    JOIN dna.import_batch batch
      ON batch.owner_id = version.owner_id
      AND batch.id = version.import_batch_id
      AND batch.source_type = 'race_merge'
      AND batch.status = 'accepted'
    LEFT JOIN dna.dataset_version_evidence_receipt evidence
      ON evidence.owner_id = version.owner_id
      AND evidence.dataset_version_id = version.id
      AND evidence.import_batch_id = version.import_batch_id
      AND evidence.source_type = 'race_merge'
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_target_version.version_number
      AND (
        batch.source_rows <= 0
        OR batch.accepted_rows <= 0
        OR evidence.dataset_version_id IS NULL
        OR evidence.evidence_kind <> 'staged_rows'
        OR evidence.evidence_partition_count NOT BETWEEN 1 AND 10000
        OR evidence.evidence_row_count <> batch.source_rows
        OR evidence.evidence_byte_size <= 0
      )
  ) THEN
    RAISE EXCEPTION 'complete sealed Race archive evidence is unavailable before refresh planning';
  END IF;

  RETURN v_inserted_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.bootstrap_race_archive_aggregate_evidence_receipts(
  uuid, uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.bootstrap_race_archive_aggregate_evidence_receipts(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.bootstrap_race_archive_aggregate_evidence_receipts(
  uuid, uuid, uuid, character
) IS
  'Idempotently seals exact staged-row evidence receipts from already-registered private Race archive objects before archive aggregate planning. It does not publish read models or authorize detailed Race-row compaction.';

COMMIT;

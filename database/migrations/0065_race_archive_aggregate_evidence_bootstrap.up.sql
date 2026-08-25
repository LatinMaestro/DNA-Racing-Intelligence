BEGIN;

CREATE OR REPLACE FUNCTION dna.begin_race_archive_aggregate_publication(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_race_dataset_version_id uuid,
  p_worker_id text,
  p_source_version_set_sha256 character(64),
  p_refreshed_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_processing dna.aggregate_refresh_processing%ROWTYPE;
  v_target_version dna.dataset_version%ROWTYPE;
  v_race_version dna.dataset_version%ROWTYPE;
  v_receipt dna.race_archive_aggregate_publication_receipt%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive aggregate publication denied';
  END IF;
  IF p_worker_id IS NULL
     OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$' THEN
    RAISE EXCEPTION 'Race archive aggregate worker ID is invalid';
  END IF;
  IF p_source_version_set_sha256 IS NULL
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive aggregate source-version checksum is invalid';
  END IF;
  IF p_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'Race archive aggregate refresh timestamp is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_owner_id::text || ':race-archive-aggregate:' || p_refresh_id::text,
      0
    )
  );

  SELECT receipt.* INTO v_receipt
  FROM dna.race_archive_aggregate_publication_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.refresh_id = p_refresh_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_receipt.race_dataset_version_id <> p_race_dataset_version_id
       OR v_receipt.source_version_set_sha256 <> p_source_version_set_sha256 THEN
      RAISE EXCEPTION 'Race archive aggregate publication replay conflict';
    END IF;
    RETURN 'published';
  END IF;

  SELECT processing.* INTO v_processing
  FROM dna.aggregate_refresh_processing processing
  WHERE processing.owner_id = p_owner_id
    AND processing.refresh_id = p_refresh_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_processing.state <> 'processing'
     OR v_processing.worker_id <> p_worker_id
     OR v_processing.source_version_set_sha256 <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive aggregate refresh claim is unavailable';
  END IF;

  SELECT version.* INTO v_target_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = v_processing.dataset_version_id
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Race archive aggregate target dataset version is unavailable';
  END IF;

  SELECT version.* INTO v_race_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_race_dataset_version_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_processing.dataset_version_id <> v_race_version.id THEN
    RAISE EXCEPTION 'active owner-scoped Race Merge archive target is unavailable';
  END IF;
  IF p_refreshed_at < GREATEST(
    v_target_version.activated_at,
    v_race_version.activated_at
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate refresh cannot predate active source versions';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive aggregate source versions were superseded';
  END IF;

  -- The immutable object manifest already exists before aggregate refresh, while the
  -- ordinary evidence-sealing API historically waited for that refresh to complete.
  -- Bootstrap only an exact staged-row receipt from registered private evidence so
  -- the first archive-backed aggregate rebuild has a sealed manifest to read. This
  -- receipt does not authorize relational compaction: compact_race_row_evidence()
  -- independently requires the aggregate job and read models to be complete.
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
    p_refreshed_at
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
    AND version.version_number <= v_race_version.version_number
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
      AND version.version_number <= v_race_version.version_number
      AND (
        batch.source_rows <= 0
        OR batch.accepted_rows <= 0
        OR evidence.dataset_version_id IS NULL
        OR evidence.evidence_kind <> 'staged_rows'
        OR evidence.evidence_row_count <> batch.source_rows
        OR evidence.evidence_partition_count NOT BETWEEN 1 AND 10000
        OR evidence.evidence_byte_size <= 0
      )
  ) THEN
    RAISE EXCEPTION 'complete sealed Race archive aggregate evidence is unavailable';
  END IF;

  DELETE FROM dna.race_archive_aggregate_publication_stage
  WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id;

  INSERT INTO dna.race_archive_aggregate_publication_stage (
    owner_id,
    refresh_id,
    target_dataset_version_id,
    race_dataset_version_id,
    worker_id,
    source_version_set_sha256,
    refreshed_at
  ) VALUES (
    p_owner_id,
    p_refresh_id,
    v_processing.dataset_version_id,
    p_race_dataset_version_id,
    p_worker_id,
    p_source_version_set_sha256,
    p_refreshed_at
  );

  RETURN 'staging';
END
$function$;

REVOKE ALL ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) IS
  'Starts an active Race archive aggregate publication after bootstrapping any missing staged-row evidence receipts from exact registered private object coverage. The receipt makes immutable history readable for the first archive-backed rebuild; detailed Race-row compaction remains separately gated on completed aggregate evidence.';

COMMIT;

BEGIN;

ALTER FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
) RENAME TO replace_race_archive_core_locators_pre_0066;

REVOKE ALL ON FUNCTION dna.replace_race_archive_core_locators_pre_0066(
  uuid, uuid, uuid, character, jsonb, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.replace_race_archive_core_locators_pre_0066(
  uuid, uuid, uuid, character, jsonb, timestamptz
) FROM dna_app_runtime;

CREATE FUNCTION dna.replace_race_archive_core_locators(
  p_owner_id uuid,
  p_dataset_version_id uuid,
  p_import_batch_id uuid,
  p_locator_set_sha256 character(64),
  p_locators jsonb,
  p_built_at timestamptz
)
RETURNS TABLE (
  status text,
  core_locator_count integer,
  ready_row_count bigint,
  partition_reference_count bigint,
  built_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_version dna.dataset_version%ROWTYPE;
  v_batch dna.import_batch%ROWTYPE;
  v_evidence dna.race_archive_prepublication_evidence_receipt%ROWTYPE;
  v_receipt dna.race_archive_core_locator_receipt%ROWTYPE;
  v_summary record;
  v_final_receipt_exists boolean;
  v_locator_count integer;
  v_distinct_core_count integer;
  v_ready_row_count bigint;
  v_partition_reference_count bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive Core locator replacement denied';
  END IF;
  IF p_locator_set_sha256 IS NULL
     OR p_locator_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive Core locator set checksum is invalid';
  END IF;
  IF p_built_at IS NULL THEN
    RAISE EXCEPTION 'Race archive Core locator build timestamp is required';
  END IF;
  IF p_locators IS NULL OR jsonb_typeof(p_locators) <> 'array' THEN
    RAISE EXCEPTION 'Race archive Core locators must be a JSON array';
  END IF;

  SELECT version.* INTO v_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_version.source_type <> 'race_merge'
     OR v_version.import_batch_id <> p_import_batch_id
     OR v_version.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'owner-scoped unrolled Race Merge dataset version is unavailable';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
    AND batch.source_type = 'race_merge'
  FOR UPDATE;

  IF NOT FOUND OR v_batch.status <> 'accepted' THEN
    RAISE EXCEPTION 'accepted owner-scoped Race Merge batch is unavailable';
  END IF;

  SELECT evidence.* INTO v_evidence
  FROM dna.race_archive_prepublication_evidence_receipt evidence
  WHERE evidence.owner_id = p_owner_id
    AND evidence.dataset_version_id = p_dataset_version_id
    AND evidence.import_batch_id = p_import_batch_id
    AND evidence.source_type = 'race_merge'
    AND evidence.evidence_kind = 'staged_rows'
  FOR UPDATE;

  IF NOT FOUND
     OR v_evidence.source_row_count <> v_batch.source_rows
     OR v_evidence.accepted_row_count <> v_batch.accepted_rows
     OR v_evidence.evidence_partition_count NOT BETWEEN 1 AND 10000
     OR v_evidence.evidence_row_count <> v_batch.source_rows
     OR v_evidence.evidence_byte_size <= 0 THEN
    RAISE EXCEPTION 'Race archive pre-publication evidence is unavailable for Core locators';
  END IF;

  SELECT * INTO STRICT v_summary
  FROM dna.race_archive_prepublication_evidence_summary(
    p_owner_id,
    p_import_batch_id
  );

  IF v_summary.evidence_partition_count <> v_evidence.evidence_partition_count
     OR v_summary.evidence_row_count <> v_evidence.evidence_row_count
     OR v_summary.evidence_byte_size <> v_evidence.evidence_byte_size
     OR v_summary.manifest_fingerprint <> v_evidence.manifest_fingerprint THEN
    RAISE EXCEPTION 'Race archive Core locator evidence drift detected';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = p_owner_id
      AND receipt.dataset_version_id = p_dataset_version_id
      AND receipt.import_batch_id = p_import_batch_id
      AND receipt.source_type = 'race_merge'
      AND receipt.evidence_kind = 'staged_rows'
      AND receipt.evidence_partition_count = v_evidence.evidence_partition_count
      AND receipt.evidence_row_count = v_evidence.evidence_row_count
      AND receipt.evidence_byte_size = v_evidence.evidence_byte_size
  ) INTO v_final_receipt_exists;

  IF v_evidence.final_receipt_required AND NOT v_final_receipt_exists THEN
    RAISE EXCEPTION 'complete sealed Race archive aggregate evidence is unavailable';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM dna.race_archive_core_locator_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.dataset_version_id = p_dataset_version_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_receipt.import_batch_id <> p_import_batch_id
       OR v_receipt.locator_set_sha256 <> p_locator_set_sha256 THEN
      RAISE EXCEPTION 'Race archive Core locator replay conflict';
    END IF;
    RETURN QUERY SELECT
      'existing'::text,
      v_receipt.core_locator_count,
      v_receipt.ready_row_count,
      v_receipt.partition_reference_count,
      v_receipt.built_at;
    RETURN;
  END IF;

  v_locator_count := jsonb_array_length(p_locators);
  IF v_locator_count NOT BETWEEN 1 AND 50000 THEN
    RAISE EXCEPTION 'Race archive Core locator count is outside its bound';
  END IF;

  WITH parsed AS (
    SELECT
      locator.source_core_id,
      locator.partition_numbers,
      locator.ready_row_count,
      locator.first_source_row_number,
      locator.last_source_row_number
    FROM jsonb_to_recordset(p_locators) AS locator(
      source_core_id text,
      partition_numbers integer[],
      ready_row_count bigint,
      first_source_row_number bigint,
      last_source_row_number bigint
    )
  )
  SELECT
    count(DISTINCT parsed.source_core_id)::integer,
    COALESCE(sum(parsed.ready_row_count), 0)::bigint,
    COALESCE(sum(cardinality(parsed.partition_numbers)), 0)::bigint
  INTO
    v_distinct_core_count,
    v_ready_row_count,
    v_partition_reference_count
  FROM parsed;

  IF v_distinct_core_count <> v_locator_count THEN
    RAISE EXCEPTION 'Race archive Core locators contain duplicate Core IDs';
  END IF;
  IF v_ready_row_count <> v_batch.accepted_rows THEN
    RAISE EXCEPTION 'Race archive Core locator row coverage is invalid';
  END IF;
  IF v_partition_reference_count <= 0 THEN
    RAISE EXCEPTION 'Race archive Core locator partition coverage is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_locators) AS locator(
      source_core_id text,
      partition_numbers integer[],
      ready_row_count bigint,
      first_source_row_number bigint,
      last_source_row_number bigint
    )
    WHERE locator.source_core_id IS NULL
      OR length(locator.source_core_id) NOT BETWEEN 1 AND 512
      OR locator.source_core_id ~ '[[:cntrl:]]'
      OR locator.partition_numbers IS NULL
      OR cardinality(locator.partition_numbers) NOT BETWEEN 1 AND 10000
      OR locator.ready_row_count IS NULL
      OR locator.ready_row_count <= 0
      OR locator.first_source_row_number IS NULL
      OR locator.first_source_row_number <= 0
      OR locator.last_source_row_number IS NULL
      OR locator.last_source_row_number < locator.first_source_row_number
      OR EXISTS (
        SELECT 1
        FROM unnest(locator.partition_numbers) AS partition_number
        WHERE partition_number IS NULL
          OR partition_number < 0
          OR partition_number >= v_evidence.evidence_partition_count
      )
      OR cardinality(locator.partition_numbers) <> (
        SELECT count(DISTINCT partition_number)::integer
        FROM unnest(locator.partition_numbers) AS partition_number
      )
      OR locator.partition_numbers <> (
        SELECT array_agg(partition_number ORDER BY partition_number)
        FROM unnest(locator.partition_numbers) AS partition_number
      )
  ) THEN
    RAISE EXCEPTION 'Race archive Core locator payload is invalid';
  END IF;

  INSERT INTO dna.race_archive_core_locator (
    owner_id,
    dataset_version_id,
    import_batch_id,
    source_core_id,
    partition_numbers,
    ready_row_count,
    first_source_row_number,
    last_source_row_number,
    built_at
  )
  SELECT
    p_owner_id,
    p_dataset_version_id,
    p_import_batch_id,
    locator.source_core_id,
    locator.partition_numbers,
    locator.ready_row_count,
    locator.first_source_row_number,
    locator.last_source_row_number,
    p_built_at
  FROM jsonb_to_recordset(p_locators) AS locator(
    source_core_id text,
    partition_numbers integer[],
    ready_row_count bigint,
    first_source_row_number bigint,
    last_source_row_number bigint
  );

  INSERT INTO dna.race_archive_core_locator_receipt (
    owner_id,
    dataset_version_id,
    import_batch_id,
    locator_set_sha256,
    core_locator_count,
    ready_row_count,
    partition_reference_count,
    built_at
  ) VALUES (
    p_owner_id,
    p_dataset_version_id,
    p_import_batch_id,
    p_locator_set_sha256,
    v_locator_count,
    v_ready_row_count,
    v_partition_reference_count,
    p_built_at
  );

  RETURN QUERY SELECT
    'sealed'::text,
    v_locator_count,
    v_ready_row_count,
    v_partition_reference_count,
    p_built_at;
END
$function$;

REVOKE ALL ON FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
) IS
  'Rebuilds exact owner-scoped Race archive Core locators from immutable checksummed staged-row evidence prepared for archive aggregate reconstruction. Pre-publication evidence is allowed before aggregate completion; once the final evidence receipt is required, the same exact evidence must remain durably sealed.';

COMMIT;

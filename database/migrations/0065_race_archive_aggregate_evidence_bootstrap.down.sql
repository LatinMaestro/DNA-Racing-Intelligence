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
        evidence.dataset_version_id IS NULL
        OR evidence.evidence_kind <> 'staged_rows'
        OR evidence.evidence_row_count <> batch.source_rows
        OR evidence.evidence_partition_count NOT BETWEEN 1 AND 10000
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
  'Starts the active Race aggregate publication from complete immutable staged-row archive evidence. Core locators are not a prerequisite for a whole-history aggregate scan; they remain a separate bounded selected-Core acceleration read model.';

COMMIT;

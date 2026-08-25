BEGIN;

CREATE OR REPLACE FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_source_version_set_sha256 character(64),
  p_maximum_versions integer
)
RETURNS TABLE (
  dataset_version_id uuid,
  import_batch_id uuid,
  version_number bigint,
  source_row_count bigint,
  accepted_row_count bigint,
  evidence_partition_count integer,
  evidence_row_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_target_version dna.dataset_version%ROWTYPE;
  v_version_count bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive aggregate refresh plan denied';
  END IF;
  IF p_source_version_set_sha256 IS NULL
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive aggregate source-version checksum is invalid';
  END IF;
  IF p_maximum_versions IS NULL OR p_maximum_versions NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Race archive aggregate version bound is invalid';
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
    RAISE EXCEPTION 'Race archive aggregate refresh claim is unavailable';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive aggregate source versions were superseded';
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
    RAISE EXCEPTION 'active Race Merge aggregate target version is unavailable';
  END IF;

  SELECT count(*)::bigint INTO v_version_count
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= v_target_version.version_number;

  IF v_version_count < 1 OR v_version_count > p_maximum_versions THEN
    RAISE EXCEPTION 'Race archive aggregate version count exceeds its bound';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_version version
    JOIN dna.import_batch batch
      ON batch.owner_id = version.owner_id
      AND batch.id = version.import_batch_id
      AND batch.source_type = 'race_merge'
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
        batch.status <> 'accepted'
        OR batch.source_rows <= 0
        OR batch.accepted_rows <= 0
        OR evidence.dataset_version_id IS NULL
        OR evidence.evidence_kind <> 'staged_rows'
        OR evidence.evidence_partition_count NOT BETWEEN 1 AND 10000
        OR evidence.evidence_row_count <> batch.source_rows
      )
  ) THEN
    RAISE EXCEPTION 'complete sealed Race archive aggregate evidence is unavailable';
  END IF;

  RETURN QUERY
  SELECT
    version.id,
    version.import_batch_id,
    version.version_number,
    batch.source_rows,
    batch.accepted_rows,
    evidence.evidence_partition_count,
    evidence.evidence_row_count
  FROM dna.dataset_version version
  JOIN dna.import_batch batch
    ON batch.owner_id = version.owner_id
    AND batch.id = version.import_batch_id
    AND batch.source_type = 'race_merge'
    AND batch.status = 'accepted'
  JOIN dna.dataset_version_evidence_receipt evidence
    ON evidence.owner_id = version.owner_id
    AND evidence.dataset_version_id = version.id
    AND evidence.import_batch_id = version.import_batch_id
    AND evidence.source_type = 'race_merge'
    AND evidence.evidence_kind = 'staged_rows'
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= v_target_version.version_number
  ORDER BY version.version_number, version.id;
END
$function$;

REVOKE ALL ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) IS
  'Returns the exact ordered sealed Race Merge version plan for one claimed archive-backed aggregate refresh from immutable staged-row evidence. Core archive locator receipts are intentionally not a plan prerequisite because the hosted archive traversal rebuilds and verifies them before aggregate publication. The historical-version bound is independent of the per-upload file-count limit.';

COMMIT;

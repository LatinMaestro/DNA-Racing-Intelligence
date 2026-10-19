BEGIN;

CREATE FUNCTION dna.read_core_performance_publication(p_owner_id uuid)
RETURNS TABLE (
  refresh_id uuid,
  race_dataset_version_id uuid,
  source_version_set_sha256 character(64),
  payload_sha256 character(64),
  core_performance_profile_count bigint,
  refreshed_at timestamptz,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_profile_count bigint;
  v_min_refreshed_at timestamptz;
  v_max_refreshed_at timestamptz;
  v_receipt_count bigint;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Core performance publication read denied';
  END IF;

  SELECT count(*)::bigint, min(profile.refreshed_at), max(profile.refreshed_at)
  INTO v_profile_count, v_min_refreshed_at, v_max_refreshed_at
  FROM dna.core_performance_profile profile
  WHERE profile.owner_id = p_owner_id;

  SELECT count(*)::bigint INTO v_receipt_count
  FROM dna.race_archive_aggregate_publication_receipt receipt
  JOIN dna.dataset_version race_version
    ON race_version.owner_id = receipt.owner_id
   AND race_version.id = receipt.race_dataset_version_id
  WHERE receipt.owner_id = p_owner_id
    AND race_version.source_type = 'race_merge'
    AND race_version.is_active
    AND race_version.rolled_back_at IS NULL
    AND race_version.aggregate_refreshed_at = receipt.refreshed_at
    AND receipt.core_performance_profile_count = v_profile_count
    AND (
      (v_profile_count = 0 AND v_min_refreshed_at IS NULL AND v_max_refreshed_at IS NULL)
      OR (v_profile_count > 0
        AND v_min_refreshed_at = receipt.refreshed_at
        AND v_max_refreshed_at = receipt.refreshed_at)
    );

  IF v_receipt_count > 1 THEN
    RAISE EXCEPTION 'Core performance publication identity is ambiguous';
  END IF;
  IF v_receipt_count = 0 THEN
    IF v_profile_count > 0 THEN
      RAISE EXCEPTION 'Core performance publication identity is unavailable';
    END IF;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT receipt.refresh_id, receipt.race_dataset_version_id,
    receipt.source_version_set_sha256, receipt.payload_sha256,
    receipt.core_performance_profile_count, receipt.refreshed_at,
    receipt.published_at
  FROM dna.race_archive_aggregate_publication_receipt receipt
  JOIN dna.dataset_version race_version
    ON race_version.owner_id = receipt.owner_id
   AND race_version.id = receipt.race_dataset_version_id
  WHERE receipt.owner_id = p_owner_id
    AND race_version.source_type = 'race_merge'
    AND race_version.is_active
    AND race_version.rolled_back_at IS NULL
    AND race_version.aggregate_refreshed_at = receipt.refreshed_at
    AND receipt.core_performance_profile_count = v_profile_count
    AND (
      (v_profile_count = 0 AND v_min_refreshed_at IS NULL AND v_max_refreshed_at IS NULL)
      OR (v_profile_count > 0
        AND v_min_refreshed_at = receipt.refreshed_at
        AND v_max_refreshed_at = receipt.refreshed_at)
    );
END
$function$;

REVOKE ALL ON FUNCTION dna.read_core_performance_publication(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_core_performance_publication(uuid) TO dna_app_runtime;

COMMIT;

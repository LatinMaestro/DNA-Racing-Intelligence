BEGIN;

CREATE FUNCTION dna.read_discovery_benchmark_publication(p_owner_id uuid)
RETURNS TABLE (
  refresh_id uuid,
  race_dataset_version_id uuid,
  source_version_set_sha256 character(64),
  payload_sha256 character(64),
  discovery_benchmark_count bigint,
  refreshed_at timestamptz,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_benchmark_count bigint;
  v_min_refreshed_at timestamptz;
  v_max_refreshed_at timestamptz;
  v_receipt_count bigint;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Discovery benchmark publication read denied';
  END IF;

  SELECT count(*)::bigint, min(benchmark.refreshed_at), max(benchmark.refreshed_at)
  INTO v_benchmark_count, v_min_refreshed_at, v_max_refreshed_at
  FROM dna.discovery_exact_distance_benchmark benchmark
  WHERE benchmark.owner_id = p_owner_id;

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
    AND receipt.discovery_benchmark_count = v_benchmark_count
    AND (
      (v_benchmark_count = 0
        AND v_min_refreshed_at IS NULL
        AND v_max_refreshed_at IS NULL)
      OR (
        v_benchmark_count > 0
        AND v_min_refreshed_at = receipt.refreshed_at
        AND v_max_refreshed_at = receipt.refreshed_at
      )
    );

  IF v_receipt_count > 1 THEN
    RAISE EXCEPTION 'Discovery benchmark publication identity is ambiguous';
  END IF;
  IF v_receipt_count = 0 THEN
    IF v_benchmark_count > 0 THEN
      RAISE EXCEPTION 'Discovery benchmark publication identity is unavailable';
    END IF;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    receipt.refresh_id,
    receipt.race_dataset_version_id,
    receipt.source_version_set_sha256,
    receipt.payload_sha256,
    receipt.discovery_benchmark_count,
    receipt.refreshed_at,
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
    AND receipt.discovery_benchmark_count = v_benchmark_count
    AND (
      (v_benchmark_count = 0
        AND v_min_refreshed_at IS NULL
        AND v_max_refreshed_at IS NULL)
      OR (
        v_benchmark_count > 0
        AND v_min_refreshed_at = receipt.refreshed_at
        AND v_max_refreshed_at = receipt.refreshed_at
      )
    );
END
$function$;

REVOKE ALL ON FUNCTION dna.read_discovery_benchmark_publication(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_discovery_benchmark_publication(uuid)
  TO dna_app_runtime;

COMMIT;

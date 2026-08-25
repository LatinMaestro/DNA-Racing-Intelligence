BEGIN;

ALTER FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) RENAME TO prepare_pro_league_aggregate_refresh_pre_race_archive_switch;

REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_race_archive_switch(
  uuid, uuid, uuid, character
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_race_archive_switch(
  uuid, uuid, uuid, character
) FROM dna_app_runtime;

CREATE FUNCTION dna.list_race_archive_aggregate_refresh_versions(
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
    LEFT JOIN dna.race_archive_core_locator_receipt locator
      ON locator.owner_id = version.owner_id
      AND locator.dataset_version_id = version.id
      AND locator.import_batch_id = version.import_batch_id
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
        OR locator.dataset_version_id IS NULL
        OR locator.ready_row_count <> batch.accepted_rows
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
  JOIN dna.race_archive_core_locator_receipt locator
    ON locator.owner_id = version.owner_id
    AND locator.dataset_version_id = version.id
    AND locator.import_batch_id = version.import_batch_id
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= v_target_version.version_number
  ORDER BY version.version_number, version.id;
END
$function$;

CREATE FUNCTION dna.prepare_pro_league_aggregate_refresh(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_source_version_set_sha256 character(64)
)
RETURNS TABLE (
  prepared_aggregate_set_id uuid,
  source_version_set_sha256 character(64),
  aggregate_family_count integer,
  materialized_row_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_target_version dna.dataset_version%ROWTYPE;
  v_receipt dna.race_archive_aggregate_publication_receipt%ROWTYPE;
  v_performance_count bigint;
  v_discovery_count bigint;
  v_payout_count bigint;
  v_star_count bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped aggregate refresh denied';
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
    RAISE EXCEPTION 'aggregate refresh claim is unavailable';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'aggregate refresh source versions were superseded';
  END IF;

  SELECT version.* INTO v_target_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active aggregate target version is unavailable';
  END IF;

  IF v_target_version.source_type <> 'race_merge' THEN
    RETURN QUERY
    SELECT previous.prepared_aggregate_set_id,
      previous.source_version_set_sha256,
      previous.aggregate_family_count,
      previous.materialized_row_count
    FROM dna.prepare_pro_league_aggregate_refresh_pre_race_archive_switch(
      p_owner_id,
      p_refresh_id,
      p_dataset_version_id,
      p_source_version_set_sha256
    ) previous;
    RETURN;
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM dna.race_archive_aggregate_publication_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.refresh_id = p_refresh_id
    AND receipt.target_dataset_version_id = p_dataset_version_id
    AND receipt.race_dataset_version_id = p_dataset_version_id
    AND receipt.source_version_set_sha256 = p_source_version_set_sha256
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM dna.race_archive_core_locator_receipt locator
      WHERE locator.owner_id = p_owner_id
        AND locator.dataset_version_id = p_dataset_version_id
    ) THEN
      RAISE EXCEPTION 'current Race archive aggregate publication is required';
    END IF;

    RETURN QUERY
    SELECT previous.prepared_aggregate_set_id,
      previous.source_version_set_sha256,
      previous.aggregate_family_count,
      previous.materialized_row_count
    FROM dna.prepare_pro_league_aggregate_refresh_pre_race_archive_switch(
      p_owner_id,
      p_refresh_id,
      p_dataset_version_id,
      p_source_version_set_sha256
    ) previous;
    RETURN;
  END IF;

  SELECT count(*)::bigint INTO v_performance_count
  FROM dna.core_performance_profile profile
  WHERE profile.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_discovery_count
  FROM dna.discovery_exact_distance_benchmark benchmark
  WHERE benchmark.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_payout_count
  FROM dna.core_payout_format_profile profile
  WHERE profile.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_star_count
  FROM dna.core_star_profile profile
  WHERE profile.owner_id = p_owner_id;

  IF v_performance_count <> v_receipt.core_performance_profile_count
     OR v_discovery_count <> v_receipt.discovery_benchmark_count
     OR v_payout_count <> v_receipt.payout_format_profile_count
     OR v_star_count <> v_receipt.core_star_profile_count
     OR EXISTS (
       SELECT 1 FROM dna.core_performance_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_receipt.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.discovery_exact_distance_benchmark benchmark
       WHERE benchmark.owner_id = p_owner_id
         AND benchmark.refreshed_at <> v_receipt.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.core_payout_format_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_receipt.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.core_star_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_receipt.refreshed_at
     ) THEN
    RAISE EXCEPTION 'current Race archive aggregate read models do not match their publication receipt';
  END IF;

  UPDATE dna.dataset_version
  SET aggregate_refreshed_at = v_receipt.refreshed_at
  WHERE owner_id = p_owner_id
    AND id = p_dataset_version_id
    AND source_type = 'race_merge'
    AND is_active
    AND rolled_back_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Race aggregate target version changed during archive finalisation';
  END IF;

  UPDATE dna.aggregate_refresh_job
  SET status = 'completed',
      started_at = COALESCE(started_at, v_receipt.refreshed_at),
      completed_at = v_receipt.published_at,
      affected_record_count = v_receipt.materialized_row_count,
      failure_code = NULL
  WHERE owner_id = p_owner_id
    AND id = p_refresh_id
    AND dataset_version_id = p_dataset_version_id
    AND status <> 'rolled_back';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Race aggregate target job changed during archive finalisation';
  END IF;

  RETURN QUERY SELECT
    p_refresh_id,
    p_source_version_set_sha256,
    4,
    v_receipt.materialized_row_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) IS
  'Returns the exact ordered sealed Race Merge version plan for one claimed archive-backed Race aggregate refresh. The bound is caller-supplied and is independent of the per-upload file-count limit.';

COMMENT ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) IS
  'Finalises Race-target aggregate preparation from the exact archive publication receipt once Race archive commissioning exists. It cannot fall back to detailed Race rows after the active Race version has archive locators. Non-Race current-source refreshes retain the archive-preserving behaviour introduced by migration 0061.';

COMMIT;

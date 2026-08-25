BEGIN;

ALTER FUNCTION dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
) RENAME TO list_import_activation_aggregate_refreshes_pre_archive_bootstrap;

CREATE FUNCTION dna.list_import_activation_aggregate_refreshes(
  p_owner_id uuid,
  p_update_session_id uuid,
  p_dispatch_id uuid,
  p_maximum_refreshes integer
)
RETURNS TABLE (refresh_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_actual_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped activation aggregate publication denied';
  END IF;
  IF p_maximum_refreshes < 1 OR p_maximum_refreshes > 24 THEN
    RAISE EXCEPTION 'aggregate refresh publication bound is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_activation_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.update_session_id = p_update_session_id
      AND processing.dispatch_id = p_dispatch_id
      AND processing.state = 'complete'
      AND processing.aggregate_refresh_required
  ) THEN
    RETURN;
  END IF;

  SELECT count(DISTINCT job.id)::integer
  INTO v_actual_count
  FROM dna.import_activation_dispatch dispatch
  JOIN dna.import_verified_upload_object object
    ON object.owner_id = dispatch.owner_id
    AND object.preview_dispatch_id = dispatch.preview_dispatch_id
  JOIN dna.dataset_version version
    ON version.owner_id = object.owner_id
    AND version.import_batch_id = object.upload_file_id
    AND version.is_active
    AND version.rolled_back_at IS NULL
  JOIN dna.aggregate_refresh_job job
    ON job.owner_id = version.owner_id
    AND job.dataset_version_id = version.id
    AND job.status <> 'rolled_back'
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.update_session_id = p_update_session_id
    AND dispatch.id = p_dispatch_id;

  IF v_actual_count < 1
     OR v_actual_count > LEAST(p_maximum_refreshes, 3) THEN
    RAISE EXCEPTION 'active activation aggregate refresh evidence is invalid';
  END IF;

  RETURN QUERY
  SELECT job.id
  FROM dna.import_activation_dispatch dispatch
  JOIN dna.import_verified_upload_object object
    ON object.owner_id = dispatch.owner_id
    AND object.preview_dispatch_id = dispatch.preview_dispatch_id
  JOIN dna.dataset_version version
    ON version.owner_id = object.owner_id
    AND version.import_batch_id = object.upload_file_id
    AND version.is_active
    AND version.rolled_back_at IS NULL
  JOIN dna.aggregate_refresh_job job
    ON job.owner_id = version.owner_id
    AND job.dataset_version_id = version.id
    AND job.status <> 'rolled_back'
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.update_session_id = p_update_session_id
    AND dispatch.id = p_dispatch_id
  GROUP BY job.id, version.source_type
  ORDER BY CASE version.source_type
    WHEN 'race_merge' THEN 1
    WHEN 'core_details' THEN 2
    WHEN 'current_arena' THEN 3
    ELSE 4
  END, job.id;
END
$function$;

REVOKE ALL ON FUNCTION dna.list_import_activation_aggregate_refreshes_pre_archive_bootstrap(
  uuid, uuid, uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_import_activation_aggregate_refreshes_pre_archive_bootstrap(
  uuid, uuid, uuid, integer
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
) TO dna_app_runtime;

ALTER FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) RENAME TO begin_race_archive_aggregate_publication_pre_bootstrap;

CREATE FUNCTION dna.begin_race_archive_aggregate_publication(
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

REVOKE ALL ON FUNCTION dna.begin_race_archive_aggregate_publication_pre_bootstrap(
  uuid, uuid, uuid, text, character, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.begin_race_archive_aggregate_publication_pre_bootstrap(
  uuid, uuid, uuid, text, character, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) TO dna_app_runtime;

ALTER FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) RENAME TO list_race_archive_aggregate_refresh_versions_pre_bootstrap;

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

REVOKE ALL ON FUNCTION dna.list_race_archive_aggregate_refresh_versions_pre_bootstrap(
  uuid, uuid, uuid, character, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_race_archive_aggregate_refresh_versions_pre_bootstrap(
  uuid, uuid, uuid, character, integer
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) TO dna_app_runtime;

ALTER FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) RENAME TO prepare_pro_league_aggregate_refresh_pre_archive_collapse;

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
  v_source_type text;
  v_target_version_number bigint;
  v_result record;
  v_receipt dna.race_archive_aggregate_publication_receipt%ROWTYPE;
BEGIN
  SELECT version.source_type, version.version_number
  INTO v_source_type, v_target_version_number
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.is_active
    AND version.rolled_back_at IS NULL;

  SELECT * INTO STRICT v_result
  FROM dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(
    p_owner_id,
    p_refresh_id,
    p_dataset_version_id,
    p_source_version_set_sha256
  );

  IF v_source_type = 'race_merge' THEN
    SELECT receipt.* INTO STRICT v_receipt
    FROM dna.race_archive_aggregate_publication_receipt receipt
    WHERE receipt.owner_id = p_owner_id
      AND receipt.refresh_id = p_refresh_id
      AND receipt.race_dataset_version_id = p_dataset_version_id
      AND receipt.source_version_set_sha256 = p_source_version_set_sha256;

    UPDATE dna.dataset_version version
    SET aggregate_refreshed_at = v_receipt.refreshed_at
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_target_version_number;

    UPDATE dna.aggregate_refresh_job job
    SET status = 'completed',
        started_at = COALESCE(job.started_at, v_receipt.refreshed_at),
        completed_at = COALESCE(job.completed_at, v_receipt.published_at),
        affected_record_count = v_receipt.materialized_row_count,
        failure_code = NULL
    FROM dna.dataset_version version
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_target_version_number
      AND job.owner_id = version.owner_id
      AND job.dataset_version_id = version.id
      AND job.status <> 'rolled_back';
  END IF;

  RETURN QUERY SELECT
    v_result.prepared_aggregate_set_id,
    v_result.source_version_set_sha256,
    v_result.aggregate_family_count,
    v_result.materialized_row_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(
  uuid, uuid, uuid, character
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(
  uuid, uuid, uuid, character
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
) IS
  'Publishes only the active changed source version from each family. For an initial multi-segment Race import this collapses historical segment jobs into the active Race target, whose archive aggregate plan covers all sealed historical Race versions. Race is ordered before Core Details and Current Arena so rolling current-source refreshes can reuse the current Race archive publication.';
COMMENT ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) IS
  'Starts the active Race aggregate publication from complete immutable staged-row archive evidence. Core locators are not a prerequisite for a whole-history aggregate scan; they remain a separate bounded selected-Core acceleration read model.';
COMMENT ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) IS
  'Returns the exact ordered immutable Race archive evidence plan for the active Race target without requiring Core locator commissioning. The caller-supplied historical version bound is independent of the 24-file upload intake bound.';
COMMENT ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) IS
  'Finalises the current active aggregate target. After a Race archive publication succeeds, all included unrolled historical Race segment jobs are marked analytically complete against the same immutable publication receipt so they require no separate repeated aggregate rebuild.';

COMMIT;

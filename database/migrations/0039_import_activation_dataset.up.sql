BEGIN;

CREATE FUNCTION dna.assert_import_activation_ready(
  p_owner_id uuid,
  p_preview_id text,
  p_preview_fingerprint_sha256 character(64)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_file_count integer;
  v_verified_count integer;
  v_source_family_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import activation readiness denied';
  END IF;

  SELECT prepared.file_count, count(object.upload_file_id)::integer,
    count(DISTINCT file.source_family)::integer
  INTO v_file_count, v_verified_count, v_source_family_count
  FROM dna.import_prepared_preview prepared
  JOIN dna.import_preview_dispatch dispatch
    ON dispatch.owner_id = prepared.owner_id
    AND dispatch.id = prepared.preview_dispatch_id
    AND dispatch.state = 'queued'
  JOIN dna.import_upload_completion completion
    ON completion.owner_id = dispatch.owner_id
    AND completion.id = dispatch.completion_id
    AND completion.state = 'verified'
  JOIN dna.import_verified_upload_object object
    ON object.owner_id = prepared.owner_id
    AND object.preview_dispatch_id = prepared.preview_dispatch_id
    AND object.upload_batch_id = prepared.upload_batch_id
  JOIN dna.import_upload_file file
    ON file.owner_id = object.owner_id
    AND file.upload_batch_id = object.upload_batch_id
    AND file.id = object.upload_file_id
    AND file.byte_length = object.advertised_byte_length
    AND file.content_type = object.advertised_content_type
    AND (
      object.provider_sha256 IS NULL
      OR object.provider_sha256 = file.sha256
    )
  WHERE prepared.owner_id = p_owner_id
    AND prepared.preview_id = p_preview_id
    AND prepared.preview_fingerprint_sha256 = p_preview_fingerprint_sha256
    AND prepared.confirmable
    AND prepared.blocking_issue_count = 0
    AND file.source_family IN ('race_merge', 'core_details', 'current_arena')
  GROUP BY prepared.file_count;

  IF v_file_count IS NULL
     OR v_file_count < 1
     OR v_file_count > 24
     OR v_verified_count <> v_file_count
     OR v_source_family_count < 1
     OR EXISTS (
       SELECT 1
       FROM dna.import_verified_upload_object object
       JOIN dna.import_upload_file file
         ON file.owner_id = object.owner_id
         AND file.id = object.upload_file_id
       JOIN dna.import_prepared_preview prepared
         ON prepared.owner_id = object.owner_id
         AND prepared.preview_dispatch_id = object.preview_dispatch_id
       WHERE prepared.owner_id = p_owner_id
         AND prepared.preview_id = p_preview_id
         AND prepared.preview_fingerprint_sha256 =
           p_preview_fingerprint_sha256
         AND file.source_family IN ('core_details', 'current_arena')
       GROUP BY file.source_family
       HAVING count(*) > 1
     ) THEN
    RAISE EXCEPTION 'verified confirmable Preview evidence is unavailable';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION dna.assert_import_activation_ready(
  uuid, text, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.assert_import_activation_ready(
  uuid, text, character
) TO dna_app_runtime;

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
  v_expected_count integer;
  v_actual_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped activation aggregate publication denied';
  END IF;
  IF p_maximum_refreshes < 1 OR p_maximum_refreshes > 24 THEN
    RAISE EXCEPTION 'aggregate refresh publication bound is invalid';
  END IF;

  SELECT processing.source_version_count
  INTO v_expected_count
  FROM dna.import_activation_processing processing
  WHERE processing.owner_id = p_owner_id
    AND processing.update_session_id = p_update_session_id
    AND processing.dispatch_id = p_dispatch_id
    AND processing.state = 'complete'
    AND processing.aggregate_refresh_required;

  IF v_expected_count IS NULL THEN
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
    AND version.rolled_back_at IS NULL
  JOIN dna.aggregate_refresh_job job
    ON job.owner_id = version.owner_id
    AND job.dataset_version_id = version.id
    AND job.status <> 'rolled_back'
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.update_session_id = p_update_session_id
    AND dispatch.id = p_dispatch_id;

  IF v_actual_count <> v_expected_count
     OR v_actual_count < 1
     OR v_actual_count > p_maximum_refreshes THEN
    RAISE EXCEPTION 'activation aggregate refresh evidence is invalid';
  END IF;

  RETURN QUERY
  SELECT DISTINCT job.id
  FROM dna.import_activation_dispatch dispatch
  JOIN dna.import_verified_upload_object object
    ON object.owner_id = dispatch.owner_id
    AND object.preview_dispatch_id = dispatch.preview_dispatch_id
  JOIN dna.dataset_version version
    ON version.owner_id = object.owner_id
    AND version.import_batch_id = object.upload_file_id
    AND version.rolled_back_at IS NULL
  JOIN dna.aggregate_refresh_job job
    ON job.owner_id = version.owner_id
    AND job.dataset_version_id = version.id
    AND job.status <> 'rolled_back'
  WHERE dispatch.owner_id = p_owner_id
    AND dispatch.update_session_id = p_update_session_id
    AND dispatch.id = p_dispatch_id
  ORDER BY job.id;
END
$function$;

REVOKE ALL ON FUNCTION dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
) TO dna_app_runtime;

CREATE FUNCTION dna.prepare_import_activation_dataset(
  p_owner_id uuid,
  p_update_session_id uuid,
  p_dispatch_id uuid,
  p_preview_fingerprint_sha256 character(64),
  p_maximum_source_versions integer
)
RETURNS TABLE (
  prepared_result_id text,
  source_version_count integer,
  quarantined_record_count bigint,
  aggregate_refresh_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_preview_dispatch_id uuid;
  v_upload_batch_id uuid;
  v_preview_file_count integer;
  v_object_count integer;
  v_batch record;
  v_data_current_through timestamptz;
  v_import_completed_at timestamptz;
  v_activated_at timestamptz;
  v_version_count integer;
  v_quarantined_count bigint;
  v_job_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped import dataset preparation denied';
  END IF;
  IF p_maximum_source_versions < 1 OR p_maximum_source_versions > 24 THEN
    RAISE EXCEPTION 'source version bound must be between 1 and 24';
  END IF;

  SELECT dispatch.preview_dispatch_id, prepared.upload_batch_id,
    prepared.file_count, GREATEST(prepared.completed_at, processing.claimed_at)
  INTO v_preview_dispatch_id, v_upload_batch_id,
    v_preview_file_count, v_activated_at
  FROM dna.import_activation_processing processing
  JOIN dna.import_activation_dispatch dispatch
    ON dispatch.owner_id = processing.owner_id
    AND dispatch.id = processing.dispatch_id
    AND dispatch.update_session_id = processing.update_session_id
  JOIN dna.import_prepared_preview prepared
    ON prepared.owner_id = dispatch.owner_id
    AND prepared.preview_dispatch_id = dispatch.preview_dispatch_id
  WHERE processing.owner_id = p_owner_id
    AND processing.dispatch_id = p_dispatch_id
    AND processing.update_session_id = p_update_session_id
    AND processing.state = 'processing'
    AND processing.preview_fingerprint_sha256 = p_preview_fingerprint_sha256
    AND dispatch.preview_fingerprint_sha256 = p_preview_fingerprint_sha256
    AND prepared.preview_fingerprint_sha256 = p_preview_fingerprint_sha256
    AND prepared.confirmable
    AND prepared.blocking_issue_count = 0
  FOR UPDATE OF processing, prepared;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claimed confirmable Preview is unavailable';
  END IF;

  SELECT count(*)::integer
  INTO v_object_count
  FROM dna.import_verified_upload_object object
  JOIN dna.import_upload_file file
    ON file.owner_id = object.owner_id
    AND file.id = object.upload_file_id
  JOIN dna.import_batch batch
    ON batch.owner_id = file.owner_id
    AND batch.id = file.id
  WHERE object.owner_id = p_owner_id
    AND object.preview_dispatch_id = v_preview_dispatch_id
    AND object.upload_batch_id = v_upload_batch_id
    AND file.upload_batch_id = v_upload_batch_id
    AND batch.source_type = file.source_family
    AND batch.checksum_sha256 = file.sha256
    AND batch.status IN ('validating', 'accepted');

  IF v_object_count <> v_preview_file_count
     OR v_object_count < 1
     OR v_object_count > p_maximum_source_versions THEN
    RAISE EXCEPTION 'verified Preview source version count is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_verified_upload_object object
    JOIN dna.import_upload_file file
      ON file.owner_id = object.owner_id
      AND file.id = object.upload_file_id
    WHERE object.owner_id = p_owner_id
      AND object.preview_dispatch_id = v_preview_dispatch_id
      AND file.source_family NOT IN (
        'race_merge', 'core_details', 'current_arena'
      )
  ) THEN
    RAISE EXCEPTION 'retired or unsupported source family cannot activate';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_verified_upload_object object
    JOIN dna.import_upload_file file
      ON file.owner_id = object.owner_id
      AND file.id = object.upload_file_id
    WHERE object.owner_id = p_owner_id
      AND object.preview_dispatch_id = v_preview_dispatch_id
      AND file.source_family IN ('core_details', 'current_arena')
    GROUP BY file.source_family
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'snapshot source family appears more than once';
  END IF;

  FOR v_batch IN
    SELECT batch.id, batch.source_type, batch.uploaded_at,
      COALESCE(max(race.event_at), batch.uploaded_at) AS source_current_through
    FROM dna.import_verified_upload_object object
    JOIN dna.import_upload_file file
      ON file.owner_id = object.owner_id
      AND file.id = object.upload_file_id
    JOIN dna.import_batch batch
      ON batch.owner_id = file.owner_id
      AND batch.id = file.id
    LEFT JOIN dna.normalized_race_staged_fact race
      ON race.owner_id = batch.owner_id
      AND race.import_batch_id = batch.id
    WHERE object.owner_id = p_owner_id
      AND object.preview_dispatch_id = v_preview_dispatch_id
      AND object.upload_batch_id = v_upload_batch_id
    GROUP BY batch.id, batch.source_type, batch.uploaded_at
    ORDER BY
      CASE batch.source_type
        WHEN 'core_details' THEN 1
        WHEN 'race_merge' THEN 2
        WHEN 'current_arena' THEN 3
        ELSE 4
      END,
      CASE WHEN batch.source_type = 'race_merge'
        THEN COALESCE(max(race.event_at), batch.uploaded_at)
        ELSE batch.uploaded_at
      END,
      batch.id
  LOOP
    v_import_completed_at := GREATEST(v_activated_at, v_batch.uploaded_at);
    v_data_current_through := v_batch.source_current_through;

    IF v_batch.source_type = 'race_merge' THEN
      SELECT GREATEST(v_data_current_through, max(version.data_current_through))
      INTO v_data_current_through
      FROM dna.dataset_version version
      WHERE version.owner_id = p_owner_id
        AND version.source_type = 'race_merge'
        AND version.is_active;

      PERFORM * FROM dna.accept_staged_race_dataset(
        v_batch.id,
        md5(v_batch.id::text || ':dataset-version')::uuid,
        v_import_completed_at,
        v_import_completed_at,
        v_data_current_through
      );
    ELSIF v_batch.source_type = 'core_details' THEN
      PERFORM * FROM dna.accept_staged_core_dataset(
        v_batch.id,
        md5(v_batch.id::text || ':dataset-version')::uuid,
        v_import_completed_at,
        v_import_completed_at,
        v_data_current_through
      );
    ELSIF v_batch.source_type = 'current_arena' THEN
      PERFORM * FROM dna.accept_staged_arena_dataset(
        v_batch.id,
        md5(v_batch.id::text || ':dataset-version')::uuid,
        v_import_completed_at,
        v_import_completed_at,
        v_data_current_through
      );
    ELSE
      RAISE EXCEPTION 'unsupported source family reached activation';
    END IF;
  END LOOP;

  SELECT count(DISTINCT version.id)::integer,
    COALESCE(sum(batch.rejected_rows), 0),
    count(DISTINCT job.id)::integer
  INTO v_version_count, v_quarantined_count, v_job_count
  FROM dna.import_verified_upload_object object
  JOIN dna.import_batch batch
    ON batch.owner_id = object.owner_id
    AND batch.id = object.upload_file_id
  LEFT JOIN dna.dataset_version version
    ON version.owner_id = batch.owner_id
    AND version.import_batch_id = batch.id
    AND version.rolled_back_at IS NULL
  LEFT JOIN dna.aggregate_refresh_job job
    ON job.owner_id = version.owner_id
    AND job.dataset_version_id = version.id
    AND job.status IN ('queued', 'running', 'completed')
  WHERE object.owner_id = p_owner_id
    AND object.preview_dispatch_id = v_preview_dispatch_id
    AND object.upload_batch_id = v_upload_batch_id;

  IF v_version_count < 1
     OR v_version_count > p_maximum_source_versions
     OR v_job_count <> v_version_count THEN
    RAISE EXCEPTION 'prepared dataset activation evidence is invalid';
  END IF;

  RETURN QUERY SELECT
    ('prepared-' || md5(
      p_owner_id::text || ':' || p_update_session_id::text || ':' ||
      p_dispatch_id::text || ':' || p_preview_fingerprint_sha256::text
    ))::text,
    v_version_count,
    v_quarantined_count,
    (v_job_count > 0);
END
$function$;

REVOKE ALL ON FUNCTION dna.prepare_import_activation_dataset(
  uuid, uuid, uuid, character, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.prepare_import_activation_dataset(
  uuid, uuid, uuid, character, integer
) TO dna_app_runtime;

COMMIT;

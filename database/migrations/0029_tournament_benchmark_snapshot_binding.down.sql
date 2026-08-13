BEGIN;

CREATE OR REPLACE FUNCTION dna.derive_tournament_candidate_snapshot(
  p_owner_id uuid,
  p_configuration_version text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_race_version dna.dataset_version%ROWTYPE;
  v_core_version dna.dataset_version%ROWTYPE;
  v_race_import_completed_at timestamptz;
  v_core_import_completed_at timestamptz;
  v_candidate_payload jsonb;
  v_profile_count bigint;
  v_profile_min_refreshed_at timestamptz;
  v_profile_max_refreshed_at timestamptz;
  v_snapshot_payload jsonb;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Tournament candidate snapshot derivation denied';
  END IF;
  IF p_configuration_version IS NULL
    OR p_configuration_version = ''
    OR p_configuration_version <> btrim(p_configuration_version)
  THEN
    RAISE EXCEPTION 'Tournament configuration version is invalid';
  END IF;

  SELECT version.*
  INTO v_race_version
  FROM dna.dataset_version version
  JOIN dna.import_batch batch
    ON batch.owner_id = version.owner_id
    AND batch.id = version.import_batch_id
    AND batch.source_type = 'race_merge'
    AND batch.status = 'accepted'
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
    AND version.data_current_through IS NOT NULL
    AND version.aggregate_refreshed_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM dna.aggregate_refresh_job job
      WHERE job.owner_id = version.owner_id
        AND job.dataset_version_id = version.id
        AND job.status = 'completed'
        AND job.completed_at = version.aggregate_refreshed_at
    );

  IF NOT FOUND THEN
    RETURN 'snapshot-unbound';
  END IF;

  SELECT version.*
  INTO v_core_version
  FROM dna.dataset_version version
  JOIN dna.import_batch batch
    ON batch.owner_id = version.owner_id
    AND batch.id = version.import_batch_id
    AND batch.source_type = 'core_details'
    AND batch.status = 'accepted'
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'core_details'
    AND version.is_active
    AND version.rolled_back_at IS NULL
    AND version.data_current_through IS NOT NULL;

  IF NOT FOUND THEN
    RETURN 'snapshot-unbound';
  END IF;

  SELECT batch.import_completed_at
  INTO v_race_import_completed_at
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = v_race_version.import_batch_id
    AND batch.source_type = 'race_merge'
    AND batch.status = 'accepted';

  SELECT batch.import_completed_at
  INTO v_core_import_completed_at
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = v_core_version.import_batch_id
    AND batch.source_type = 'core_details'
    AND batch.status = 'accepted';

  IF v_race_import_completed_at IS NULL OR v_core_import_completed_at IS NULL THEN
    RETURN 'snapshot-unbound';
  END IF;

  SELECT
    count(*),
    min(profile.refreshed_at),
    max(profile.refreshed_at)
  INTO
    v_profile_count,
    v_profile_min_refreshed_at,
    v_profile_max_refreshed_at
  FROM dna.core_performance_profile profile
  WHERE profile.owner_id = p_owner_id;

  IF v_profile_count = 0
    OR v_profile_min_refreshed_at <> v_race_version.aggregate_refreshed_at
    OR v_profile_max_refreshed_at <> v_race_version.aggregate_refreshed_at
  THEN
    RETURN 'snapshot-unbound';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'coreId', core.source_core_id,
      'coreClass', core.core_class,
      'element', core.element,
      'fNumber', core.f_number,
      'sex', core.sex,
      'coreSourceImportBatchId', core.source_import_batch_id::text,
      'coreDetailsActive', EXISTS (
        SELECT 1
        FROM dna.active_core_details active_core
        WHERE active_core.owner_id = core.owner_id
          AND active_core.id = core.id
      ),
      'vaultVersion', vault.version,
      'meEligible', vault.me_eligible
    )
    ORDER BY core.source_core_id
  )
  INTO v_candidate_payload
  FROM dna.owner_vault_core vault
  JOIN dna.core core
    ON core.owner_id = vault.owner_id
    AND core.id = vault.core_id
  WHERE vault.owner_id = p_owner_id
    AND vault.in_my_vault;

  IF v_candidate_payload IS NULL THEN
    RETURN 'snapshot-unbound';
  END IF;

  v_snapshot_payload := jsonb_build_object(
    'configurationVersion', p_configuration_version,
    'raceDatasetVersionId', v_race_version.id::text,
    'raceDatasetVersionNumber', v_race_version.version_number,
    'raceDataCurrentThrough', to_char(
      timezone('UTC', v_race_version.data_current_through),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'raceImportCompletedAt', to_char(
      timezone('UTC', v_race_import_completed_at),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'raceAggregateRefreshedAt', to_char(
      timezone('UTC', v_race_version.aggregate_refreshed_at),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'coreDatasetVersionId', v_core_version.id::text,
    'coreDatasetVersionNumber', v_core_version.version_number,
    'coreDataCurrentThrough', to_char(
      timezone('UTC', v_core_version.data_current_through),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'coreImportCompletedAt', to_char(
      timezone('UTC', v_core_import_completed_at),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'candidates', v_candidate_payload
  );

  RETURN 'snapshot-' || md5(v_snapshot_payload::text);
END
$function$;

COMMIT;

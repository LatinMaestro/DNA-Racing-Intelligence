BEGIN;

CREATE FUNCTION dna.derive_tournament_candidate_snapshot(
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
  v_import_completed_at timestamptz;
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

  SELECT version.*, batch.import_completed_at
  INTO v_race_version, v_import_completed_at
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
      timezone('UTC', v_import_completed_at),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'raceAggregateRefreshedAt', to_char(
      timezone('UTC', v_race_version.aggregate_refreshed_at),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'candidates', v_candidate_payload
  );

  RETURN 'snapshot-' || md5(v_snapshot_payload::text);
END
$function$;

CREATE FUNCTION dna.bind_tournament_candidate_snapshot(
  p_owner_id uuid,
  p_tournament_id text,
  p_bracket_id text,
  p_expected_configuration_version text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_configuration dna.tournament_configuration%ROWTYPE;
  v_snapshot_version text;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Tournament candidate snapshot binding denied';
  END IF;

  SELECT configuration.*
  INTO v_configuration
  FROM dna.tournament_configuration configuration
  WHERE configuration.owner_id = p_owner_id
    AND configuration.tournament_id = p_tournament_id
    AND configuration.bracket_id = p_bracket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped Tournament configuration does not exist';
  END IF;
  IF p_expected_configuration_version IS NULL
    OR p_expected_configuration_version <> v_configuration.configuration_version
  THEN
    RAISE EXCEPTION 'Tournament configuration version drifted before candidate binding';
  END IF;

  v_snapshot_version := dna.derive_tournament_candidate_snapshot(
    p_owner_id,
    v_configuration.configuration_version
  );
  IF v_snapshot_version = 'snapshot-unbound' THEN
    RAISE EXCEPTION 'Tournament candidate evidence is incomplete';
  END IF;

  UPDATE dna.tournament_configuration configuration
  SET candidate_snapshot_version = v_snapshot_version
  WHERE configuration.owner_id = p_owner_id
    AND configuration.tournament_id = p_tournament_id
    AND configuration.bracket_id = p_bracket_id;

  RETURN v_snapshot_version;
END
$function$;

CREATE FUNCTION dna.list_bound_tournament_configurations(p_owner_id uuid)
RETURNS SETOF dna.tournament_configuration
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_configuration dna.tournament_configuration%ROWTYPE;
  v_expected_snapshot_version text;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped bound Tournament configuration read denied';
  END IF;

  FOR v_configuration IN
    SELECT configuration.*
    FROM dna.tournament_configuration configuration
    WHERE configuration.owner_id = p_owner_id
    ORDER BY
      configuration.tournament_label,
      configuration.split_label,
      configuration.bracket_id
  LOOP
    v_expected_snapshot_version :=
      dna.derive_tournament_candidate_snapshot(
        p_owner_id,
        v_configuration.configuration_version
      );
    IF v_configuration.candidate_snapshot_version
      <> v_expected_snapshot_version
    THEN
      v_configuration.candidate_snapshot_version := 'snapshot-unbound';
    END IF;
    RETURN NEXT v_configuration;
  END LOOP;

  RETURN;
END
$function$;

REVOKE ALL ON FUNCTION
  dna.derive_tournament_candidate_snapshot(uuid, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  dna.bind_tournament_candidate_snapshot(uuid, text, text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  dna.list_bound_tournament_configurations(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.bind_tournament_candidate_snapshot(uuid, text, text, text)
TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION
  dna.list_bound_tournament_configurations(uuid)
TO dna_app_runtime;

COMMIT;

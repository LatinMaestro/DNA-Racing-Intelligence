BEGIN;

CREATE FUNCTION dna.upsert_tournament_configuration(
  p_owner_id uuid,
  p_tournament_id text,
  p_tournament_label text,
  p_bracket_id text,
  p_split_label text,
  p_mode text,
  p_eligible_distances_metres integer[],
  p_discovery_relevance text,
  p_qualification_metric_label text,
  p_configuration_version text,
  p_candidate_snapshot_version text,
  p_updated_at timestamptz
)
RETURNS TABLE (
  tournament_id text,
  bracket_id text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Tournament configuration write denied';
  END IF;
  IF p_updated_at IS NULL THEN
    RAISE EXCEPTION 'Tournament configuration update timestamp is required';
  END IF;

  INSERT INTO dna.tournament_configuration (
    owner_id,
    tournament_id,
    tournament_label,
    bracket_id,
    split_label,
    mode,
    eligible_distances_metres,
    discovery_relevance,
    qualification_metric_label,
    configuration_version,
    candidate_snapshot_version,
    updated_at
  )
  VALUES (
    p_owner_id,
    p_tournament_id,
    p_tournament_label,
    p_bracket_id,
    p_split_label,
    p_mode,
    p_eligible_distances_metres,
    p_discovery_relevance,
    p_qualification_metric_label,
    p_configuration_version,
    p_candidate_snapshot_version,
    p_updated_at
  )
  ON CONFLICT ON CONSTRAINT tournament_configuration_pkey
  DO UPDATE SET
    tournament_label = EXCLUDED.tournament_label,
    split_label = EXCLUDED.split_label,
    mode = EXCLUDED.mode,
    eligible_distances_metres = EXCLUDED.eligible_distances_metres,
    discovery_relevance = EXCLUDED.discovery_relevance,
    qualification_metric_label = EXCLUDED.qualification_metric_label,
    configuration_version = EXCLUDED.configuration_version,
    candidate_snapshot_version = EXCLUDED.candidate_snapshot_version,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY
  SELECT
    configuration.tournament_id,
    configuration.bracket_id,
    configuration.updated_at
  FROM dna.tournament_configuration configuration
  WHERE configuration.owner_id = p_owner_id
    AND configuration.tournament_id = p_tournament_id
    AND configuration.bracket_id = p_bracket_id;
END
$function$;

REVOKE ALL ON FUNCTION dna.upsert_tournament_configuration(
  uuid, text, text, text, text, text, integer[], text, text, text, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.upsert_tournament_configuration(
  uuid, text, text, text, text, text, integer[], text, text, text, text, timestamptz
) TO dna_app_runtime;

COMMIT;

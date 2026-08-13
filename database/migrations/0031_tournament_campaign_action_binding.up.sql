BEGIN;

ALTER TABLE dna.tournament_configuration
  DROP CONSTRAINT tournament_campaign_action_valid,
  ADD CONSTRAINT tournament_campaign_action_valid CHECK (
    campaign_action IS NULL
    OR (
      jsonb_typeof(campaign_action) = 'object'
      AND campaign_action ->> 'kind' IN (
        'configured',
        'review_only_free_text'
      )
      AND nullif(btrim(campaign_action ->> 'action'), '') IS NOT NULL
      AND (
        campaign_action ->> 'kind' = 'review_only_free_text'
        OR (
          nullif(btrim(campaign_action ->> 'ownerAcknowledgedAt'), '') IS NOT NULL
          AND nullif(btrim(campaign_action ->> 'evidence'), '') IS NOT NULL
          AND campaign_action ->> 'configurationVersion' =
            configuration_version
          AND campaign_action ->> 'candidateSnapshotVersion' =
            candidate_snapshot_version
          AND candidate_snapshot_version <> 'snapshot-unbound'
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION dna.upsert_complete_tournament_configuration(
  p_owner_id uuid,
  p_tournament_id text,
  p_tournament_label text,
  p_season_label text,
  p_qualification_starts_at timestamptz,
  p_qualification_ends_at timestamptz,
  p_bracket_id text,
  p_split_label text,
  p_mode text,
  p_eligible_distances_metres integer[],
  p_gate_count integer,
  p_entry_fee_amount numeric,
  p_entry_fee_asset text,
  p_race_format text,
  p_eligible_breeds text[],
  p_eligible_classes text[],
  p_eligible_elements text[],
  p_eligible_f_numbers integer[],
  p_eligible_f_number_ranges jsonb,
  p_eligibility_groups jsonb,
  p_leaderboard_split_dimension text,
  p_leaderboard_groups jsonb,
  p_minimum_race_count integer,
  p_qualification_count integer,
  p_qualification_percentage numeric,
  p_ranking_metric text,
  p_top_finish_position integer,
  p_points_table jsonb,
  p_custom_scoring_configuration jsonb,
  p_qualifying_race_semantics text,
  p_discovery_relevance text,
  p_rule_evidence_status text,
  p_rule_notes text,
  p_source_evidence text,
  p_provenance jsonb,
  p_campaign_action jsonb
)
RETURNS TABLE (
  configuration_version text,
  candidate_snapshot_version text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_configuration_payload jsonb;
  v_configuration_version text;
  v_updated_at timestamptz := statement_timestamp();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped complete Tournament configuration write denied';
  END IF;

  v_configuration_payload := jsonb_build_object(
    'tournamentId', p_tournament_id,
    'tournamentLabel', p_tournament_label,
    'seasonLabel', p_season_label,
    'qualificationStartsAt', p_qualification_starts_at,
    'qualificationEndsAt', p_qualification_ends_at,
    'bracketId', p_bracket_id,
    'splitLabel', p_split_label,
    'mode', p_mode,
    'eligibleDistancesMetres', to_jsonb(p_eligible_distances_metres),
    'gateCount', p_gate_count,
    'entryFee', jsonb_build_object(
      'amount', p_entry_fee_amount::text,
      'asset', p_entry_fee_asset
    ),
    'raceFormat', p_race_format,
    'eligibility', jsonb_build_object(
      'breeds', to_jsonb(p_eligible_breeds),
      'classes', to_jsonb(p_eligible_classes),
      'elements', to_jsonb(p_eligible_elements),
      'fNumbers', to_jsonb(p_eligible_f_numbers),
      'fNumberRanges', p_eligible_f_number_ranges,
      'groups', p_eligibility_groups
    ),
    'leaderboard', jsonb_build_object(
      'splitDimension', p_leaderboard_split_dimension,
      'groups', p_leaderboard_groups,
      'qualifyingRaceSemantics', p_qualifying_race_semantics
    ),
    'qualification', jsonb_build_object(
      'minimumRaceCount', p_minimum_race_count,
      'target', CASE
        WHEN p_qualification_count IS NOT NULL
          THEN jsonb_build_object(
            'kind', 'count',
            'value', p_qualification_count
          )
        ELSE jsonb_build_object(
          'kind', 'percentage',
          'value', p_qualification_percentage::text
        )
      END,
      'rankingMetric', p_ranking_metric,
      'topFinishPosition', p_top_finish_position,
      'pointsTable', p_points_table,
      'customScoringConfiguration', p_custom_scoring_configuration
    ),
    'discoveryRelevance', p_discovery_relevance,
    'evidence', jsonb_build_object(
      'status', p_rule_evidence_status,
      'notes', p_rule_notes,
      'sourceEvidence', p_source_evidence,
      'provenance', p_provenance
    ),
    'campaignAction', p_campaign_action
  );
  v_configuration_version :=
    'cfg-' || md5(v_configuration_payload::text);

  INSERT INTO dna.tournament_configuration (
    owner_id,
    tournament_id,
    tournament_label,
    season_label,
    qualification_starts_at,
    qualification_ends_at,
    bracket_id,
    split_label,
    mode,
    eligible_distances_metres,
    gate_count,
    entry_fee_amount,
    entry_fee_asset,
    race_format,
    eligible_breeds,
    eligible_classes,
    eligible_elements,
    eligible_f_numbers,
    eligible_f_number_ranges,
    eligibility_groups,
    leaderboard_split_dimension,
    leaderboard_groups,
    minimum_race_count,
    qualification_count,
    qualification_percentage,
    ranking_metric,
    top_finish_position,
    points_table,
    custom_scoring_configuration,
    qualifying_race_semantics,
    discovery_relevance,
    qualification_metric_label,
    rule_evidence_status,
    rule_notes,
    source_evidence,
    provenance,
    campaign_action,
    configuration_version,
    candidate_snapshot_version,
    updated_at
  )
  VALUES (
    p_owner_id,
    p_tournament_id,
    p_tournament_label,
    p_season_label,
    p_qualification_starts_at,
    p_qualification_ends_at,
    p_bracket_id,
    p_split_label,
    p_mode,
    p_eligible_distances_metres,
    p_gate_count,
    p_entry_fee_amount,
    p_entry_fee_asset,
    p_race_format,
    p_eligible_breeds,
    p_eligible_classes,
    p_eligible_elements,
    p_eligible_f_numbers,
    p_eligible_f_number_ranges,
    p_eligibility_groups,
    p_leaderboard_split_dimension,
    p_leaderboard_groups,
    p_minimum_race_count,
    p_qualification_count,
    p_qualification_percentage,
    p_ranking_metric,
    p_top_finish_position,
    p_points_table,
    p_custom_scoring_configuration,
    p_qualifying_race_semantics,
    p_discovery_relevance,
    p_ranking_metric,
    p_rule_evidence_status,
    p_rule_notes,
    p_source_evidence,
    p_provenance,
    p_campaign_action,
    v_configuration_version,
    'snapshot-unbound',
    v_updated_at
  )
  ON CONFLICT ON CONSTRAINT tournament_configuration_pkey
  DO UPDATE SET
    tournament_label = EXCLUDED.tournament_label,
    season_label = EXCLUDED.season_label,
    qualification_starts_at = EXCLUDED.qualification_starts_at,
    qualification_ends_at = EXCLUDED.qualification_ends_at,
    split_label = EXCLUDED.split_label,
    mode = EXCLUDED.mode,
    eligible_distances_metres = EXCLUDED.eligible_distances_metres,
    gate_count = EXCLUDED.gate_count,
    entry_fee_amount = EXCLUDED.entry_fee_amount,
    entry_fee_asset = EXCLUDED.entry_fee_asset,
    race_format = EXCLUDED.race_format,
    eligible_breeds = EXCLUDED.eligible_breeds,
    eligible_classes = EXCLUDED.eligible_classes,
    eligible_elements = EXCLUDED.eligible_elements,
    eligible_f_numbers = EXCLUDED.eligible_f_numbers,
    eligible_f_number_ranges = EXCLUDED.eligible_f_number_ranges,
    eligibility_groups = EXCLUDED.eligibility_groups,
    leaderboard_split_dimension = EXCLUDED.leaderboard_split_dimension,
    leaderboard_groups = EXCLUDED.leaderboard_groups,
    minimum_race_count = EXCLUDED.minimum_race_count,
    qualification_count = EXCLUDED.qualification_count,
    qualification_percentage = EXCLUDED.qualification_percentage,
    ranking_metric = EXCLUDED.ranking_metric,
    top_finish_position = EXCLUDED.top_finish_position,
    points_table = EXCLUDED.points_table,
    custom_scoring_configuration =
      EXCLUDED.custom_scoring_configuration,
    qualifying_race_semantics = EXCLUDED.qualifying_race_semantics,
    discovery_relevance = EXCLUDED.discovery_relevance,
    qualification_metric_label = EXCLUDED.qualification_metric_label,
    rule_evidence_status = EXCLUDED.rule_evidence_status,
    rule_notes = EXCLUDED.rule_notes,
    source_evidence = EXCLUDED.source_evidence,
    provenance = EXCLUDED.provenance,
    campaign_action = EXCLUDED.campaign_action,
    configuration_version = EXCLUDED.configuration_version,
    candidate_snapshot_version = CASE
      WHEN dna.tournament_configuration.configuration_version =
        EXCLUDED.configuration_version
        THEN dna.tournament_configuration.candidate_snapshot_version
      ELSE 'snapshot-unbound'
    END,
    updated_at = CASE
      WHEN dna.tournament_configuration.configuration_version =
        EXCLUDED.configuration_version
        THEN dna.tournament_configuration.updated_at
      ELSE EXCLUDED.updated_at
    END;

  RETURN QUERY
  SELECT
    configuration.configuration_version,
    configuration.candidate_snapshot_version,
    configuration.updated_at
  FROM dna.tournament_configuration configuration
  WHERE configuration.owner_id = p_owner_id
    AND configuration.tournament_id = p_tournament_id
    AND configuration.bracket_id = p_bracket_id;
END
$function$;

CREATE FUNCTION dna.acknowledge_tournament_campaign_action(
  p_owner_id uuid,
  p_tournament_id text,
  p_bracket_id text,
  p_expected_configuration_version text,
  p_expected_candidate_snapshot_version text,
  p_action text,
  p_evidence text
)
RETURNS TABLE (
  configuration_version text,
  candidate_snapshot_version text,
  owner_acknowledged_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_acknowledged_at timestamptz := statement_timestamp();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Tournament campaign action write denied';
  END IF;
  IF nullif(btrim(p_action), '') IS NULL OR length(btrim(p_action)) > 200
    OR nullif(btrim(p_evidence), '') IS NULL
    OR length(btrim(p_evidence)) > 2000
  THEN
    RAISE EXCEPTION 'Tournament campaign action evidence is invalid';
  END IF;
  IF p_expected_candidate_snapshot_version = 'snapshot-unbound' THEN
    RAISE EXCEPTION 'Tournament campaign action snapshot is not bound';
  END IF;

  RETURN QUERY
  UPDATE dna.tournament_configuration AS configuration
  SET campaign_action = jsonb_build_object(
    'kind', 'configured',
    'action', btrim(p_action),
    'ownerAcknowledgedAt', to_char(
      timezone('UTC', v_acknowledged_at),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'evidence', btrim(p_evidence),
    'configurationVersion', p_expected_configuration_version,
    'candidateSnapshotVersion', p_expected_candidate_snapshot_version
  )
  WHERE configuration.owner_id = p_owner_id
    AND configuration.tournament_id = p_tournament_id
    AND configuration.bracket_id = p_bracket_id
    AND configuration.configuration_version =
      p_expected_configuration_version
    AND configuration.candidate_snapshot_version =
      p_expected_candidate_snapshot_version
  RETURNING
    configuration.configuration_version,
    configuration.candidate_snapshot_version,
    v_acknowledged_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Tournament campaign action configuration or snapshot drifted';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION dna.acknowledge_tournament_campaign_action(
  uuid, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.acknowledge_tournament_campaign_action(
  uuid, text, text, text, text, text, text
) TO dna_app_runtime;

COMMIT;

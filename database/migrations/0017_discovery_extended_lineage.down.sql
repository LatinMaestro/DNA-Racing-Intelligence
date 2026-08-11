BEGIN;

CREATE OR REPLACE FUNCTION dna.list_discovery_lineage_hypotheses(
  p_owner_id uuid,
  p_limit integer
)
RETURNS TABLE (
  core_id text,
  core_name text,
  me_eligible boolean,
  mode text,
  distance integer,
  lineage_relationship text,
  lineage_race_count bigint,
  data_current_through timestamptz,
  last_imported_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Discovery lineage read denied';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Discovery lineage result limit is invalid';
  END IF;

  RETURN QUERY
  WITH lineage_profiles AS (
    SELECT
      owned.source_core_id AS owned_source_core_id,
      owned.display_name AS owned_display_name,
      vault.me_eligible AS owned_me_eligible,
      profile.mode,
      profile.distance,
      reachability.generation_band,
      profile.race_count,
      profile.data_current_through,
      CASE reachability.generation_band
        WHEN 'parent' THEN 1
        WHEN 'grandparent' THEN 2
        ELSE 99
      END AS relation_rank
    FROM dna.owner_vault_core vault
    JOIN dna.core owned
      ON owned.owner_id = vault.owner_id
      AND owned.id = vault.core_id
    JOIN dna.core_lineage_reachability reachability
      ON reachability.owner_id = owned.owner_id
      AND reachability.descendant_core_id = owned.id
      AND reachability.generation_band IN ('parent', 'grandparent')
    JOIN dna.core ancestor
      ON ancestor.owner_id = reachability.owner_id
      AND ancestor.id = reachability.ancestor_core_id
    JOIN dna.core_performance_profile profile
      ON profile.owner_id = ancestor.owner_id
      AND profile.source_core_id = ancestor.source_core_id
    WHERE
      vault.owner_id = p_owner_id
      AND vault.in_my_vault
      AND NOT EXISTS (
        SELECT 1
        FROM dna.core_lineage_validation_issue issue
        WHERE issue.owner_id = vault.owner_id
          AND issue.core_id IN (owned.id, ancestor.id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dna.core_performance_profile direct_profile
        WHERE direct_profile.owner_id = owned.owner_id
          AND direct_profile.source_core_id = owned.source_core_id
          AND direct_profile.mode = profile.mode
          AND direct_profile.distance = profile.distance
      )
  ),
  ranked AS (
    SELECT
      lineage_profiles.*,
      min(relation_rank) OVER (
        PARTITION BY owned_source_core_id, mode, distance
      ) AS selected_relation_rank
    FROM lineage_profiles
  ),
  hypotheses AS (
    SELECT
      owned_source_core_id,
      owned_display_name,
      owned_me_eligible,
      mode,
      distance,
      CASE selected_relation_rank
        WHEN 1 THEN 'parent'
        WHEN 2 THEN 'grandparent'
      END AS lineage_relationship,
      sum(race_count)::bigint AS lineage_race_count,
      max(data_current_through) AS data_current_through
    FROM ranked
    WHERE relation_rank = selected_relation_rank
    GROUP BY
      owned_source_core_id,
      owned_display_name,
      owned_me_eligible,
      mode,
      distance,
      selected_relation_rank
  )
  SELECT
    hypothesis.owned_source_core_id,
    hypothesis.owned_display_name,
    hypothesis.owned_me_eligible,
    hypothesis.mode,
    hypothesis.distance,
    hypothesis.lineage_relationship,
    hypothesis.lineage_race_count,
    hypothesis.data_current_through,
    (
      SELECT max(batch.import_completed_at)
      FROM dna.import_batch batch
      WHERE batch.owner_id = p_owner_id
        AND batch.source_type = 'race_merge'
        AND batch.status = 'accepted'
    )
  FROM hypotheses hypothesis
  ORDER BY
    hypothesis.owned_display_name,
    hypothesis.owned_source_core_id,
    hypothesis.mode,
    hypothesis.distance
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON FUNCTION dna.list_discovery_lineage_hypotheses(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_discovery_lineage_hypotheses(uuid, integer)
  TO dna_app_runtime;

COMMIT;

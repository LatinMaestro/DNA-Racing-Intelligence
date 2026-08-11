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
  WITH owned AS (
    SELECT
      core.owner_id,
      core.id AS owned_core_id,
      core.source_core_id AS owned_source_core_id,
      core.display_name AS owned_display_name,
      vault.me_eligible AS owned_me_eligible
    FROM dna.owner_vault_core vault
    JOIN dna.core core
      ON core.owner_id = vault.owner_id
      AND core.id = vault.core_id
    WHERE vault.owner_id = p_owner_id AND vault.in_my_vault
  ),
  sibling_relatives AS (
    SELECT
      owned.owned_core_id,
      relative_parent.child_core_id AS relative_core_id,
      CASE count(DISTINCT owned_parent.parent_core_id)
        WHEN 2 THEN 'full_sibling'
        WHEN 1 THEN 'half_sibling'
      END AS relationship,
      CASE count(DISTINCT owned_parent.parent_core_id)
        WHEN 2 THEN 3
        WHEN 1 THEN 4
      END AS relation_rank
    FROM owned
    JOIN dna.core_parent owned_parent
      ON owned_parent.owner_id = owned.owner_id
      AND owned_parent.child_core_id = owned.owned_core_id
    JOIN dna.core_parent relative_parent
      ON relative_parent.owner_id = owned_parent.owner_id
      AND relative_parent.parent_core_id = owned_parent.parent_core_id
      AND relative_parent.child_core_id <> owned.owned_core_id
    GROUP BY owned.owned_core_id, relative_parent.child_core_id
    HAVING count(DISTINCT owned_parent.parent_core_id) IN (1, 2)
  ),
  relatives AS (
    SELECT
      owned.owned_core_id,
      reachability.ancestor_core_id AS relative_core_id,
      reachability.generation_band AS relationship,
      CASE reachability.generation_band WHEN 'parent' THEN 1 ELSE 2 END AS relation_rank
    FROM owned
    JOIN dna.core_lineage_reachability reachability
      ON reachability.owner_id = owned.owner_id
      AND reachability.descendant_core_id = owned.owned_core_id
      AND reachability.generation_band IN ('parent', 'grandparent')

    UNION ALL

    SELECT owned_core_id, relative_core_id, relationship, relation_rank
    FROM sibling_relatives

    UNION ALL

    SELECT
      owned.owned_core_id,
      child.child_core_id,
      'offspring',
      5
    FROM owned
    JOIN dna.core_parent child
      ON child.owner_id = owned.owner_id
      AND child.parent_core_id = owned.owned_core_id

    UNION ALL

    SELECT DISTINCT
      owned.owned_core_id,
      reachability.ancestor_core_id,
      'wider_lineage',
      6
    FROM owned
    JOIN dna.core_lineage_reachability reachability
      ON reachability.owner_id = owned.owner_id
      AND reachability.descendant_core_id = owned.owned_core_id
      AND reachability.generation_band = 'distant'

    UNION ALL

    SELECT DISTINCT
      owned.owned_core_id,
      reachability.descendant_core_id,
      'wider_lineage',
      6
    FROM owned
    JOIN dna.core_lineage_reachability reachability
      ON reachability.owner_id = owned.owner_id
      AND reachability.ancestor_core_id = owned.owned_core_id
      AND reachability.generation_band <> 'parent'
  ),
  relative_profiles AS (
    SELECT
      owned.owned_source_core_id,
      owned.owned_display_name,
      owned.owned_me_eligible,
      relative.relationship,
      relative.relation_rank,
      profile.mode,
      profile.distance,
      profile.race_count,
      profile.data_current_through
    FROM owned
    JOIN relatives relative
      ON relative.owned_core_id = owned.owned_core_id
    JOIN dna.core evidence_core
      ON evidence_core.owner_id = owned.owner_id
      AND evidence_core.id = relative.relative_core_id
    JOIN dna.core_performance_profile profile
      ON profile.owner_id = evidence_core.owner_id
      AND profile.source_core_id = evidence_core.source_core_id
    WHERE
      NOT EXISTS (
        SELECT 1
        FROM dna.core_lineage_validation_issue issue
        WHERE issue.owner_id = owned.owner_id
          AND issue.core_id IN (owned.owned_core_id, evidence_core.id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dna.core_performance_profile direct_profile
        WHERE direct_profile.owner_id = owned.owner_id
          AND direct_profile.source_core_id = owned.owned_source_core_id
          AND direct_profile.mode = profile.mode
          AND direct_profile.distance = profile.distance
      )
  ),
  ranked AS (
    SELECT
      relative_profiles.*,
      min(relation_rank) OVER (
        PARTITION BY owned_source_core_id, mode, distance
      ) AS selected_relation_rank
    FROM relative_profiles
  ),
  hypotheses AS (
    SELECT
      owned_source_core_id,
      owned_display_name,
      owned_me_eligible,
      mode,
      distance,
      min(relationship) AS lineage_relationship,
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

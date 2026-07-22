BEGIN;

CREATE TABLE dna.core_lineage_reachability (
  owner_id uuid NOT NULL,
  descendant_core_id uuid NOT NULL,
  ancestor_core_id uuid NOT NULL,
  generation_band text NOT NULL CHECK (
    generation_band IN ('parent', 'grandparent', 'distant')
  ),
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, descendant_core_id, ancestor_core_id),
  FOREIGN KEY (owner_id, descendant_core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, ancestor_core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE CASCADE,
  CHECK (descendant_core_id <> ancestor_core_id)
);

CREATE INDEX core_lineage_reachability_by_ancestor
  ON dna.core_lineage_reachability(owner_id, ancestor_core_id, descendant_core_id);

CREATE TABLE dna.core_lineage_validation_issue (
  owner_id uuid NOT NULL,
  core_id uuid NOT NULL,
  issue_code text NOT NULL CHECK (
    issue_code IN (
      'cycle',
      'genesis_has_parent',
      'non_genesis_parent_count',
      'core_class_missing'
    )
  ),
  evidence_core_ids uuid[] NOT NULL DEFAULT '{}',
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, core_id, issue_code),
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE CASCADE
);

CREATE FUNCTION dna.refresh_core_lineage(p_refreshed_at timestamptz)
RETURNS TABLE (
  reachability_count bigint,
  issue_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for lineage refresh';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':lineage-refresh', 0)
  );

  DELETE FROM dna.core_lineage_reachability
  WHERE owner_id = v_owner_id;

  DELETE FROM dna.core_lineage_validation_issue
  WHERE owner_id = v_owner_id;

  INSERT INTO dna.core_lineage_validation_issue (
    owner_id,
    core_id,
    issue_code,
    evidence_core_ids,
    refreshed_at
  )
  SELECT
    core.owner_id,
    core.id,
    CASE
      WHEN core.core_class IS NULL THEN 'core_class_missing'
      WHEN core.core_class = 'Genesis' THEN 'genesis_has_parent'
      ELSE 'non_genesis_parent_count'
    END,
    COALESCE(parent.parents, '{}'::uuid[]),
    p_refreshed_at
  FROM dna.core core
  LEFT JOIN LATERAL (
    SELECT
      array_agg(edge.parent_core_id ORDER BY edge.parent_core_id) AS parents,
      count(*) AS parent_count
    FROM dna.core_parent edge
    WHERE edge.owner_id = core.owner_id AND edge.child_core_id = core.id
  ) parent ON true
  WHERE
    core.owner_id = v_owner_id
    AND (
      core.core_class IS NULL
      OR (core.core_class = 'Genesis' AND parent.parent_count <> 0)
      OR (core.core_class <> 'Genesis' AND parent.parent_count <> 2)
    );

  WITH RECURSIVE reachable(descendant_core_id, ancestor_core_id) AS (
    SELECT edge.child_core_id, edge.parent_core_id
    FROM dna.core_parent edge
    WHERE edge.owner_id = v_owner_id

    UNION

    SELECT reachable.descendant_core_id, edge.parent_core_id
    FROM reachable
    JOIN dna.core_parent edge
      ON edge.owner_id = v_owner_id
      AND edge.child_core_id = reachable.ancestor_core_id
  )
  INSERT INTO dna.core_lineage_validation_issue (
    owner_id,
    core_id,
    issue_code,
    evidence_core_ids,
    refreshed_at
  )
  SELECT
    v_owner_id,
    reachable.descendant_core_id,
    'cycle',
    ARRAY[reachable.descendant_core_id],
    p_refreshed_at
  FROM reachable
  WHERE reachable.descendant_core_id = reachable.ancestor_core_id
  ON CONFLICT (owner_id, core_id, issue_code) DO UPDATE SET
    evidence_core_ids = EXCLUDED.evidence_core_ids,
    refreshed_at = EXCLUDED.refreshed_at;

  WITH RECURSIVE reachable(descendant_core_id, ancestor_core_id) AS (
    SELECT edge.child_core_id, edge.parent_core_id
    FROM dna.core_parent edge
    WHERE edge.owner_id = v_owner_id

    UNION

    SELECT reachable.descendant_core_id, edge.parent_core_id
    FROM reachable
    JOIN dna.core_parent edge
      ON edge.owner_id = v_owner_id
      AND edge.child_core_id = reachable.ancestor_core_id
  ),
  direct AS (
    SELECT edge.child_core_id, edge.parent_core_id
    FROM dna.core_parent edge
    WHERE edge.owner_id = v_owner_id
  ),
  second_generation AS (
    SELECT DISTINCT child.child_core_id, parent.parent_core_id
    FROM dna.core_parent child
    JOIN dna.core_parent parent
      ON parent.owner_id = child.owner_id
      AND parent.child_core_id = child.parent_core_id
    WHERE child.owner_id = v_owner_id
  )
  INSERT INTO dna.core_lineage_reachability (
    owner_id,
    descendant_core_id,
    ancestor_core_id,
    generation_band,
    refreshed_at
  )
  SELECT
    v_owner_id,
    reachable.descendant_core_id,
    reachable.ancestor_core_id,
    CASE
      WHEN direct.child_core_id IS NOT NULL THEN 'parent'
      WHEN second_generation.child_core_id IS NOT NULL THEN 'grandparent'
      ELSE 'distant'
    END,
    p_refreshed_at
  FROM reachable
  LEFT JOIN direct
    ON direct.child_core_id = reachable.descendant_core_id
    AND direct.parent_core_id = reachable.ancestor_core_id
  LEFT JOIN second_generation
    ON second_generation.child_core_id = reachable.descendant_core_id
    AND second_generation.parent_core_id = reachable.ancestor_core_id
  WHERE reachable.descendant_core_id <> reachable.ancestor_core_id;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM dna.core_lineage_reachability WHERE owner_id = v_owner_id),
    (SELECT count(*) FROM dna.core_lineage_validation_issue WHERE owner_id = v_owner_id);
END
$function$;

CREATE FUNCTION dna.evaluate_family_pair(p_core_a_id uuid, p_core_b_id uuid)
RETURNS TABLE (
  eligibility_status text,
  relation_code text,
  evidence_core_ids uuid[]
)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_shared_parents uuid[];
  v_core_count integer;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for family evaluation';
  END IF;

  IF p_core_a_id = p_core_b_id THEN
    RETURN QUERY SELECT 'review_required', 'same_core', ARRAY[p_core_a_id];
    RETURN;
  END IF;

  SELECT count(*) INTO v_core_count
  FROM dna.core core
  WHERE core.owner_id = v_owner_id AND core.id IN (p_core_a_id, p_core_b_id);

  IF v_core_count <> 2 THEN
    RETURN QUERY
    SELECT 'review_required', 'unknown_core', ARRAY[p_core_a_id, p_core_b_id];
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.core_lineage_validation_issue issue
    WHERE
      issue.owner_id = v_owner_id
      AND issue.issue_code = 'cycle'
      AND (
        issue.core_id IN (p_core_a_id, p_core_b_id)
        OR EXISTS (
          SELECT 1
          FROM dna.core_lineage_reachability reachability
          WHERE
            reachability.owner_id = v_owner_id
            AND reachability.descendant_core_id IN (p_core_a_id, p_core_b_id)
            AND reachability.ancestor_core_id = issue.core_id
        )
      )
  ) THEN
    RETURN QUERY
    SELECT 'review_required', 'invalid_lineage', ARRAY[p_core_a_id, p_core_b_id];
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.core_parent edge
    WHERE
      edge.owner_id = v_owner_id
      AND (
        (edge.child_core_id = p_core_a_id AND edge.parent_core_id = p_core_b_id)
        OR (edge.child_core_id = p_core_b_id AND edge.parent_core_id = p_core_a_id)
      )
  ) THEN
    RETURN QUERY SELECT 'ineligible', 'parent', ARRAY[p_core_a_id, p_core_b_id];
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.core_lineage_reachability reachability
    WHERE
      reachability.owner_id = v_owner_id
      AND reachability.generation_band = 'grandparent'
      AND (
        (reachability.descendant_core_id = p_core_a_id AND reachability.ancestor_core_id = p_core_b_id)
        OR (reachability.descendant_core_id = p_core_b_id AND reachability.ancestor_core_id = p_core_a_id)
      )
  ) THEN
    RETURN QUERY SELECT 'ineligible', 'grandparent', ARRAY[p_core_a_id, p_core_b_id];
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(parent_a.parent_core_id ORDER BY parent_a.parent_core_id), '{}'::uuid[])
  INTO v_shared_parents
  FROM dna.core_parent parent_a
  JOIN dna.core_parent parent_b
    ON parent_b.owner_id = parent_a.owner_id
    AND parent_b.parent_core_id = parent_a.parent_core_id
    AND parent_b.child_core_id = p_core_b_id
  WHERE parent_a.owner_id = v_owner_id AND parent_a.child_core_id = p_core_a_id;

  IF cardinality(v_shared_parents) = 2
    AND (SELECT count(*) FROM dna.core_parent WHERE owner_id = v_owner_id AND child_core_id = p_core_a_id) = 2
    AND (SELECT count(*) FROM dna.core_parent WHERE owner_id = v_owner_id AND child_core_id = p_core_b_id) = 2
  THEN
    RETURN QUERY SELECT 'ineligible', 'full_sibling', v_shared_parents;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.core_lineage_validation_issue issue
    WHERE
      issue.owner_id = v_owner_id
      AND issue.core_id IN (p_core_a_id, p_core_b_id)
  ) THEN
    RETURN QUERY
    SELECT 'review_required', 'incomplete_lineage', ARRAY[p_core_a_id, p_core_b_id];
    RETURN;
  END IF;

  IF cardinality(v_shared_parents) = 1 THEN
    RETURN QUERY SELECT 'eligible', 'half_sibling_allowed', v_shared_parents;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.core_lineage_reachability reachability
    WHERE
      reachability.owner_id = v_owner_id
      AND reachability.generation_band = 'distant'
      AND (
        (reachability.descendant_core_id = p_core_a_id AND reachability.ancestor_core_id = p_core_b_id)
        OR (reachability.descendant_core_id = p_core_b_id AND reachability.ancestor_core_id = p_core_a_id)
      )
  ) THEN
    RETURN QUERY
    SELECT 'eligible', 'distant_descendant_allowed', ARRAY[p_core_a_id, p_core_b_id];
    RETURN;
  END IF;

  RETURN QUERY SELECT 'eligible', 'unrelated_or_other_allowed', '{}'::uuid[];
END
$function$;

ALTER TABLE dna.core_lineage_reachability ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.core_lineage_reachability FORCE ROW LEVEL SECURITY;
CREATE POLICY core_lineage_reachability_owner_policy
  ON dna.core_lineage_reachability
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.core_lineage_validation_issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.core_lineage_validation_issue FORCE ROW LEVEL SECURITY;
CREATE POLICY core_lineage_validation_issue_owner_policy
  ON dna.core_lineage_validation_issue
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

REVOKE ALL ON dna.core_lineage_reachability FROM PUBLIC;
REVOKE ALL ON dna.core_lineage_validation_issue FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_core_lineage(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.evaluate_family_pair(uuid, uuid) FROM PUBLIC;

COMMIT;

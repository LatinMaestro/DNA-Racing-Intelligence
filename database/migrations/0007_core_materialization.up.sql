BEGIN;

ALTER TABLE dna.core_parent
  ADD COLUMN active_in_core_details boolean NOT NULL DEFAULT false;

DROP INDEX dna.core_parent_one_known_role;
CREATE UNIQUE INDEX core_parent_one_active_known_role
  ON dna.core_parent(owner_id, child_core_id, parent_role)
  WHERE parent_role <> 'unknown' AND active_in_core_details;

CREATE TABLE dna.normalized_core_staged_fact (
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  source_core_id text NOT NULL CHECK (btrim(source_core_id) <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  core_class text NOT NULL CHECK (
    core_class IN ('Genesis', 'Morphed', 'Freak', 'X-Class')
  ),
  element text NOT NULL CHECK (
    element IN ('Metal', 'Fire', 'Earth', 'Water')
  ),
  f_number integer NOT NULL CHECK (f_number > 0),
  sex text NOT NULL CHECK (sex IN ('male', 'female')),
  color_source_value text,
  father_source_core_id text,
  father_name_source_value text,
  mother_source_core_id text,
  mother_name_source_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, import_batch_id, source_row_number),
  FOREIGN KEY (owner_id, import_batch_id, source_row_number)
    REFERENCES dna.dataset_staged_record(
      owner_id,
      import_batch_id,
      source_row_number
    ) ON DELETE CASCADE
);

CREATE TABLE dna.core_parent_import_provenance (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  core_parent_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  parent_role text NOT NULL CHECK (
    parent_role IN ('parent_1', 'parent_2')
  ),
  raw_parent_source_core_id text NOT NULL,
  raw_parent_source_name text,
  source_row_checksum character(64) NOT NULL CHECK (
    source_row_checksum ~ '^[a-f0-9]{64}$'
  ),
  is_selected_fact boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, core_parent_id, import_batch_id),
  FOREIGN KEY (owner_id, core_parent_id)
    REFERENCES dna.core_parent(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE
);

CREATE VIEW dna.active_core_details
WITH (security_invoker = true)
AS
SELECT
  core.id,
  core.owner_id,
  core.source_core_id,
  core.display_name,
  core.core_class,
  core.element,
  core.f_number,
  core.sex,
  core.source_import_batch_id,
  core.created_at,
  core.updated_at
FROM dna.core core
WHERE EXISTS (
  SELECT 1
  FROM dna.core_import_provenance provenance
  WHERE
    provenance.owner_id = core.owner_id
    AND provenance.core_id = core.id
    AND provenance.is_selected_fact
);

ALTER TABLE dna.normalized_core_staged_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.normalized_core_staged_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.normalized_core_staged_fact
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.core_parent_import_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.core_parent_import_provenance FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.core_parent_import_provenance
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER FUNCTION dna.refresh_core_lineage(timestamptz)
  RENAME TO refresh_core_lineage_unfiltered;

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
    WHERE
      edge.owner_id = core.owner_id
      AND edge.child_core_id = core.id
      AND edge.active_in_core_details
  ) parent ON true
  WHERE
    core.owner_id = v_owner_id
    AND (
      EXISTS (
        SELECT 1
        FROM dna.core_import_provenance provenance
        WHERE
          provenance.owner_id = core.owner_id
          AND provenance.core_id = core.id
          AND provenance.is_selected_fact
      )
      OR EXISTS (
        SELECT 1
        FROM dna.core_parent edge
        WHERE
          edge.owner_id = core.owner_id
          AND edge.active_in_core_details
          AND (
            edge.child_core_id = core.id
            OR edge.parent_core_id = core.id
          )
      )
    )
    AND (
      core.core_class IS NULL
      OR (core.core_class = 'Genesis' AND parent.parent_count <> 0)
      OR (core.core_class <> 'Genesis' AND parent.parent_count <> 2)
    );

  WITH RECURSIVE reachable(descendant_core_id, ancestor_core_id) AS (
    SELECT edge.child_core_id, edge.parent_core_id
    FROM dna.core_parent edge
    WHERE edge.owner_id = v_owner_id AND edge.active_in_core_details

    UNION

    SELECT reachable.descendant_core_id, edge.parent_core_id
    FROM reachable
    JOIN dna.core_parent edge
      ON edge.owner_id = v_owner_id
      AND edge.child_core_id = reachable.ancestor_core_id
      AND edge.active_in_core_details
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
    WHERE edge.owner_id = v_owner_id AND edge.active_in_core_details

    UNION

    SELECT reachable.descendant_core_id, edge.parent_core_id
    FROM reachable
    JOIN dna.core_parent edge
      ON edge.owner_id = v_owner_id
      AND edge.child_core_id = reachable.ancestor_core_id
      AND edge.active_in_core_details
  ),
  direct AS (
    SELECT edge.child_core_id, edge.parent_core_id
    FROM dna.core_parent edge
    WHERE edge.owner_id = v_owner_id AND edge.active_in_core_details
  ),
  second_generation AS (
    SELECT DISTINCT child.child_core_id, parent.parent_core_id
    FROM dna.core_parent child
    JOIN dna.core_parent parent
      ON parent.owner_id = child.owner_id
      AND parent.child_core_id = child.parent_core_id
      AND parent.active_in_core_details
    WHERE
      child.owner_id = v_owner_id
      AND child.active_in_core_details
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

ALTER FUNCTION dna.evaluate_family_pair(uuid, uuid)
  RENAME TO evaluate_family_pair_graph;

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
  v_existing_count integer;
  v_active_count integer;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for family evaluation';
  END IF;

  IF p_core_a_id = p_core_b_id THEN
    RETURN QUERY
    SELECT *
    FROM dna.evaluate_family_pair_graph(p_core_a_id, p_core_b_id);
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_existing_count
  FROM dna.core core
  WHERE
    core.owner_id = v_owner_id
    AND core.id IN (p_core_a_id, p_core_b_id);

  IF v_existing_count <> 2 THEN
    RETURN QUERY
    SELECT *
    FROM dna.evaluate_family_pair_graph(p_core_a_id, p_core_b_id);
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_active_count
  FROM dna.active_core_details core
  WHERE
    core.owner_id = v_owner_id
    AND core.id IN (p_core_a_id, p_core_b_id);

  IF v_active_count <> 2 THEN
    RETURN QUERY
    SELECT
      'review_required'::text,
      'inactive_core_details'::text,
      ARRAY[p_core_a_id, p_core_b_id];
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM dna.evaluate_family_pair_graph(p_core_a_id, p_core_b_id);
END
$function$;

CREATE FUNCTION dna.accept_staged_core_dataset(
  p_import_batch_id uuid,
  p_dataset_version_id uuid,
  p_import_completed_at timestamptz,
  p_activated_at timestamptz,
  p_data_current_through timestamptz
)
RETURNS TABLE (
  result_status text,
  activated_version_number bigint,
  materialized_core_count bigint,
  materialized_parent_edge_count bigint,
  lineage_issue_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_batch dna.import_batch%ROWTYPE;
  v_result_status text;
  v_version_number bigint;
  v_ready_count bigint;
  v_fact_count bigint;
  v_core_count bigint := 0;
  v_edge_count bigint := 0;
  v_issue_count bigint := 0;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for Core Details acceptance';
  END IF;

  SELECT *
  INTO v_batch
  FROM dna.import_batch
  WHERE owner_id = v_owner_id AND id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND OR v_batch.source_type <> 'core_details' THEN
    RAISE EXCEPTION 'owner-scoped Core Details import batch does not exist';
  END IF;

  SELECT count(*)
  INTO v_ready_count
  FROM dna.dataset_staged_record
  WHERE
    owner_id = v_owner_id
    AND import_batch_id = p_import_batch_id
    AND status = 'ready';

  SELECT count(*)
  INTO v_fact_count
  FROM dna.normalized_core_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready';

  IF v_ready_count <> v_fact_count THEN
    RAISE EXCEPTION 'every ready Core Details row requires one normalized fact';
  END IF;

  IF v_batch.status = 'validating' THEN
    UPDATE dna.dataset_staged_record staged
    SET
      status = 'quarantined',
      issue_codes = CASE
        WHEN staged.issue_codes @> ARRAY['SELF_PARENT']
          THEN staged.issue_codes
        ELSE array_append(staged.issue_codes, 'SELF_PARENT')
      END
    FROM dna.normalized_core_staged_fact fact
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.owner_id = staged.owner_id
      AND fact.import_batch_id = staged.import_batch_id
      AND fact.source_row_number = staged.source_row_number
      AND (
        fact.father_source_core_id = fact.source_core_id
        OR fact.mother_source_core_id = fact.source_core_id
      );

    UPDATE dna.dataset_staged_record staged
    SET
      status = 'quarantined',
      issue_codes = CASE
        WHEN staged.issue_codes @> ARRAY['DUPLICATE_PARENT']
          THEN staged.issue_codes
        ELSE array_append(staged.issue_codes, 'DUPLICATE_PARENT')
      END
    FROM dna.normalized_core_staged_fact fact
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.owner_id = staged.owner_id
      AND fact.import_batch_id = staged.import_batch_id
      AND fact.source_row_number = staged.source_row_number
      AND fact.father_source_core_id IS NOT NULL
      AND fact.father_source_core_id = fact.mother_source_core_id;

    WITH inconsistent_cores AS (
      SELECT fact.source_core_id
      FROM dna.normalized_core_staged_fact fact
      JOIN dna.dataset_staged_record staged
        ON staged.owner_id = fact.owner_id
        AND staged.import_batch_id = fact.import_batch_id
        AND staged.source_row_number = fact.source_row_number
      WHERE
        fact.owner_id = v_owner_id
        AND fact.import_batch_id = p_import_batch_id
        AND staged.status = 'ready'
      GROUP BY fact.source_core_id
      HAVING count(
        DISTINCT ROW(
          fact.display_name,
          fact.core_class,
          fact.element,
          fact.f_number,
          fact.sex,
          fact.father_source_core_id,
          fact.mother_source_core_id
        )
      ) > 1
    )
    UPDATE dna.dataset_staged_record staged
    SET
      status = 'quarantined',
      issue_codes = CASE
        WHEN staged.issue_codes @> ARRAY['CORE_FACT_CONFLICT']
          THEN staged.issue_codes
        ELSE array_append(staged.issue_codes, 'CORE_FACT_CONFLICT')
      END
    FROM dna.normalized_core_staged_fact fact
    JOIN inconsistent_cores conflict
      ON conflict.source_core_id = fact.source_core_id
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.owner_id = staged.owner_id
      AND fact.import_batch_id = staged.import_batch_id
      AND fact.source_row_number = staged.source_row_number;

    UPDATE dna.dataset_staged_record staged
    SET
      status = 'quarantined',
      issue_codes = CASE
        WHEN staged.issue_codes @> ARRAY['CORE_IDENTITY_CONFLICT']
          THEN staged.issue_codes
        ELSE array_append(staged.issue_codes, 'CORE_IDENTITY_CONFLICT')
      END
    FROM dna.normalized_core_staged_fact fact
    JOIN dna.core existing
      ON existing.owner_id = fact.owner_id
      AND existing.source_core_id = fact.source_core_id
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.owner_id = staged.owner_id
      AND fact.import_batch_id = staged.import_batch_id
      AND fact.source_row_number = staged.source_row_number
      AND EXISTS (
        SELECT 1
        FROM dna.core_import_provenance provenance
        WHERE
          provenance.owner_id = existing.owner_id
          AND provenance.core_id = existing.id
          AND provenance.is_selected_fact
      )
      AND (
        existing.display_name IS DISTINCT FROM fact.display_name
        OR existing.core_class IS DISTINCT FROM fact.core_class
        OR existing.element IS DISTINCT FROM fact.element
        OR existing.f_number IS DISTINCT FROM fact.f_number
        OR existing.sex IS DISTINCT FROM fact.sex
      );

    WITH proposed_edges AS (
      SELECT
        fact.owner_id,
        fact.import_batch_id,
        fact.source_row_number,
        fact.source_core_id AS child_source_core_id,
        parent.parent_role,
        parent.parent_source_core_id
      FROM dna.normalized_core_staged_fact fact
      CROSS JOIN LATERAL (VALUES
        ('parent_1'::text, fact.father_source_core_id),
        ('parent_2'::text, fact.mother_source_core_id)
      ) parent(parent_role, parent_source_core_id)
      WHERE parent.parent_source_core_id IS NOT NULL
    )
    UPDATE dna.dataset_staged_record staged
    SET
      status = 'quarantined',
      issue_codes = CASE
        WHEN staged.issue_codes @> ARRAY['PARENT_ROLE_CONFLICT']
          THEN staged.issue_codes
        ELSE array_append(staged.issue_codes, 'PARENT_ROLE_CONFLICT')
      END
    FROM proposed_edges proposed
    JOIN dna.core_parent existing_edge
      ON existing_edge.owner_id = proposed.owner_id
      AND existing_edge.child_core_id = md5(
        proposed.owner_id::text
        || ':core:'
        || proposed.child_source_core_id
      )::uuid
      AND existing_edge.parent_role = proposed.parent_role
      AND existing_edge.active_in_core_details
      AND existing_edge.parent_core_id <> md5(
        proposed.owner_id::text
        || ':core:'
        || proposed.parent_source_core_id
      )::uuid
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND proposed.owner_id = staged.owner_id
      AND proposed.import_batch_id = staged.import_batch_id
      AND proposed.source_row_number = staged.source_row_number;
  END IF;

  SELECT accepted.result_status, accepted.activated_version_number
  INTO v_result_status, v_version_number
  FROM dna.accept_staged_dataset(
    p_import_batch_id,
    p_dataset_version_id,
    p_import_completed_at,
    p_activated_at,
    p_data_current_through
  ) accepted;

  IF v_result_status = 'quarantined' THEN
    RETURN QUERY
    SELECT v_result_status, v_version_number, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  WITH parent_ids AS (
    SELECT fact.father_source_core_id AS source_core_id
    FROM dna.normalized_core_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.father_source_core_id IS NOT NULL

    UNION

    SELECT fact.mother_source_core_id
    FROM dna.normalized_core_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.mother_source_core_id IS NOT NULL
  )
  INSERT INTO dna.core (
    id,
    owner_id,
    source_core_id,
    source_import_batch_id,
    created_at,
    updated_at
  )
  SELECT
    md5(v_owner_id::text || ':core:' || parent.source_core_id)::uuid,
    v_owner_id,
    parent.source_core_id,
    p_import_batch_id,
    p_activated_at,
    p_activated_at
  FROM parent_ids parent
  ON CONFLICT (owner_id, source_core_id) DO NOTHING;

  INSERT INTO dna.core AS existing (
    id,
    owner_id,
    source_core_id,
    display_name,
    core_class,
    element,
    f_number,
    sex,
    source_import_batch_id,
    created_at,
    updated_at
  )
  SELECT DISTINCT ON (fact.source_core_id)
    md5(v_owner_id::text || ':core:' || fact.source_core_id)::uuid,
    v_owner_id,
    fact.source_core_id,
    fact.display_name,
    fact.core_class,
    fact.element,
    fact.f_number,
    fact.sex,
    p_import_batch_id,
    p_activated_at,
    p_activated_at
  FROM dna.normalized_core_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready'
  ORDER BY fact.source_core_id, fact.source_row_number
  ON CONFLICT (owner_id, source_core_id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    core_class = EXCLUDED.core_class,
    element = EXCLUDED.element,
    f_number = EXCLUDED.f_number,
    sex = EXCLUDED.sex,
    source_import_batch_id = EXCLUDED.source_import_batch_id,
    updated_at = EXCLUDED.updated_at;

  SELECT count(DISTINCT fact.source_core_id)
  INTO v_core_count
  FROM dna.normalized_core_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready';

  INSERT INTO dna.core_import_provenance (
    id,
    owner_id,
    core_id,
    import_batch_id,
    source_row_number,
    raw_source_core_id,
    raw_source_name,
    is_selected_fact,
    created_at
  )
  SELECT DISTINCT ON (core.id)
    md5(
      v_owner_id::text
      || ':core_provenance:'
      || core.id::text
      || ':'
      || p_import_batch_id::text
    )::uuid,
    v_owner_id,
    core.id,
    p_import_batch_id,
    fact.source_row_number,
    fact.source_core_id,
    fact.display_name,
    true,
    p_activated_at
  FROM dna.normalized_core_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  JOIN dna.core core
    ON core.owner_id = fact.owner_id
    AND core.source_core_id = fact.source_core_id
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready'
  ORDER BY core.id, fact.source_row_number
  ON CONFLICT (owner_id, core_id, import_batch_id) DO UPDATE
  SET is_selected_fact = true;

  WITH proposed_edges AS (
    SELECT
      fact.owner_id,
      fact.import_batch_id,
      fact.source_row_number,
      fact.source_core_id AS child_source_core_id,
      parent.parent_role,
      parent.parent_source_core_id,
      parent.parent_source_name
    FROM dna.normalized_core_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
    CROSS JOIN LATERAL (VALUES
      ('parent_1'::text, fact.father_source_core_id, fact.father_name_source_value),
      ('parent_2'::text, fact.mother_source_core_id, fact.mother_name_source_value)
    ) parent(parent_role, parent_source_core_id, parent_source_name)
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND parent.parent_source_core_id IS NOT NULL
  )
  INSERT INTO dna.core_parent AS existing (
    id,
    owner_id,
    child_core_id,
    parent_core_id,
    parent_role,
    source_import_batch_id,
    active_in_core_details,
    created_at
  )
  SELECT
    md5(
      v_owner_id::text
      || ':core_parent:'
      || proposed.child_source_core_id
      || ':'
      || proposed.parent_source_core_id
    )::uuid,
    v_owner_id,
    md5(v_owner_id::text || ':core:' || proposed.child_source_core_id)::uuid,
    md5(v_owner_id::text || ':core:' || proposed.parent_source_core_id)::uuid,
    proposed.parent_role,
    p_import_batch_id,
    true,
    p_activated_at
  FROM proposed_edges proposed
  ON CONFLICT (owner_id, child_core_id, parent_core_id) DO UPDATE
  SET
    source_import_batch_id = EXCLUDED.source_import_batch_id,
    active_in_core_details = true;

  WITH proposed_edges AS (
    SELECT
      fact.source_row_number,
      fact.source_core_id AS child_source_core_id,
      staged.fingerprint_sha256,
      parent.parent_role,
      parent.parent_source_core_id,
      parent.parent_source_name
    FROM dna.normalized_core_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
    CROSS JOIN LATERAL (VALUES
      ('parent_1'::text, fact.father_source_core_id, fact.father_name_source_value),
      ('parent_2'::text, fact.mother_source_core_id, fact.mother_name_source_value)
    ) parent(parent_role, parent_source_core_id, parent_source_name)
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND parent.parent_source_core_id IS NOT NULL
  )
  INSERT INTO dna.core_parent_import_provenance (
    id,
    owner_id,
    core_parent_id,
    import_batch_id,
    source_row_number,
    parent_role,
    raw_parent_source_core_id,
    raw_parent_source_name,
    source_row_checksum,
    is_selected_fact,
    created_at
  )
  SELECT
    md5(
      v_owner_id::text
      || ':core_parent_provenance:'
      || edge.id::text
      || ':'
      || p_import_batch_id::text
    )::uuid,
    v_owner_id,
    edge.id,
    p_import_batch_id,
    proposed.source_row_number,
    proposed.parent_role,
    proposed.parent_source_core_id,
    proposed.parent_source_name,
    proposed.fingerprint_sha256,
    true,
    p_activated_at
  FROM proposed_edges proposed
  JOIN dna.core_parent edge
    ON edge.owner_id = v_owner_id
    AND edge.child_core_id = md5(
      v_owner_id::text || ':core:' || proposed.child_source_core_id
    )::uuid
    AND edge.parent_core_id = md5(
      v_owner_id::text || ':core:' || proposed.parent_source_core_id
    )::uuid
  ON CONFLICT (owner_id, core_parent_id, import_batch_id) DO UPDATE
  SET is_selected_fact = true;

  SELECT count(DISTINCT edge.id)
  INTO v_edge_count
  FROM dna.core_parent edge
  JOIN dna.core_parent_import_provenance provenance
    ON provenance.owner_id = edge.owner_id
    AND provenance.core_parent_id = edge.id
  WHERE
    edge.owner_id = v_owner_id
    AND provenance.import_batch_id = p_import_batch_id
    AND provenance.is_selected_fact;

  SELECT refreshed.issue_count
  INTO v_issue_count
  FROM dna.refresh_core_lineage(p_activated_at) refreshed;

  RETURN QUERY
  SELECT
    v_result_status,
    v_version_number,
    v_core_count,
    v_edge_count,
    v_issue_count;
END
$function$;

ALTER FUNCTION dna.rollback_active_dataset(text, text, timestamptz)
  RENAME TO rollback_active_dataset_pre_core;

CREATE FUNCTION dna.rollback_active_dataset(
  p_source_type text,
  p_reason text,
  p_rolled_back_at timestamptz
)
RETURNS TABLE (
  rolled_back_version_number bigint,
  restored_version_number bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_rolled_back_version bigint;
  v_restored_version bigint;
  v_rolled_back_batch_id uuid;
BEGIN
  SELECT rollback.rolled_back_version_number, rollback.restored_version_number
  INTO v_rolled_back_version, v_restored_version
  FROM dna.rollback_active_dataset_pre_core(
    p_source_type,
    p_reason,
    p_rolled_back_at
  ) rollback;

  IF p_source_type = 'core_details' THEN
    SELECT import_batch_id
    INTO v_rolled_back_batch_id
    FROM dna.dataset_version
    WHERE
      owner_id = v_owner_id
      AND source_type = 'core_details'
      AND version_number = v_rolled_back_version;

    UPDATE dna.core_parent_import_provenance
    SET is_selected_fact = false
    WHERE
      owner_id = v_owner_id
      AND import_batch_id = v_rolled_back_batch_id;

    UPDATE dna.core_parent edge
    SET active_in_core_details = EXISTS (
        SELECT 1
        FROM dna.core_parent_import_provenance provenance
        WHERE
          provenance.owner_id = edge.owner_id
          AND provenance.core_parent_id = edge.id
          AND provenance.is_selected_fact
      )
    WHERE edge.owner_id = v_owner_id AND edge.active_in_core_details;

    UPDATE dna.core_parent edge
    SET source_import_batch_id = (
      SELECT provenance.import_batch_id
      FROM dna.core_parent_import_provenance provenance
      WHERE
        provenance.owner_id = edge.owner_id
        AND provenance.core_parent_id = edge.id
        AND provenance.is_selected_fact
      ORDER BY provenance.created_at DESC, provenance.import_batch_id DESC
      LIMIT 1
    )
    WHERE edge.owner_id = v_owner_id AND edge.active_in_core_details;

    UPDATE dna.core_import_provenance
    SET is_selected_fact = false
    WHERE
      owner_id = v_owner_id
      AND import_batch_id = v_rolled_back_batch_id;

    UPDATE dna.core core
    SET
      source_import_batch_id = (
        SELECT provenance.import_batch_id
        FROM dna.core_import_provenance provenance
        WHERE
          provenance.owner_id = core.owner_id
          AND provenance.core_id = core.id
          AND provenance.is_selected_fact
        ORDER BY provenance.created_at DESC, provenance.import_batch_id DESC
        LIMIT 1
      ),
      updated_at = p_rolled_back_at
    WHERE core.owner_id = v_owner_id;

    PERFORM dna.refresh_core_lineage(p_rolled_back_at);
  END IF;

  RETURN QUERY SELECT v_rolled_back_version, v_restored_version;
END
$function$;

REVOKE ALL ON TABLE dna.normalized_core_staged_fact FROM PUBLIC;
REVOKE ALL ON TABLE dna.core_parent_import_provenance FROM PUBLIC;
REVOKE ALL ON TABLE dna.active_core_details FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_core_lineage_unfiltered(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_core_lineage(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.evaluate_family_pair_graph(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.evaluate_family_pair(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_staged_core_dataset(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset_pre_core(
  text,
  text,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text,
  text,
  timestamptz
) FROM PUBLIC;

COMMIT;

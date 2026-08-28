BEGIN;

ALTER TABLE dna.dna_open_lab_sync_generation
  ADD COLUMN materialization_contract_version smallint NOT NULL DEFAULT 0
  CHECK (materialization_contract_version BETWEEN 0 AND 1);

CREATE TABLE dna.dna_open_lab_owned_core_snapshot (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  source_core_id bigint NOT NULL CHECK (
    source_core_id BETWEEN 1 AND 9007199254740991
  ),
  display_name text NOT NULL CHECK (
    length(display_name) BETWEEN 1 AND 256
    AND display_name !~ '[[:cntrl:]]'
  ),
  core_class text NOT NULL CHECK (
    core_class IN ('Genesis', 'Morphed', 'Freak', 'X-Class')
  ),
  element text NOT NULL CHECK (
    element IN ('Metal', 'Fire', 'Earth', 'Water')
  ),
  f_number integer NOT NULL CHECK (f_number BETWEEN 1 AND 1000000),
  sex text NOT NULL CHECK (sex IN ('male', 'female')),
  color_source_value text CHECK (
    color_source_value IS NULL OR (
      length(color_source_value) BETWEEN 1 AND 256
      AND color_source_value !~ '[[:cntrl:]]'
    )
  ),
  observed_at timestamptz NOT NULL,
  raw_evidence_sha256 character(64) NOT NULL CHECK (
    raw_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  PRIMARY KEY (owner_id, generation_id, source_core_id),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
    ON DELETE CASCADE
);

ALTER TABLE dna.dna_open_lab_owned_core_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_owned_core_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_owned_core_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.stage_dna_open_lab_materialized_candidate(
  p_owner_id uuid,
  p_generation_id uuid,
  p_observed_at timestamptz,
  p_recorded_at timestamptz,
  p_families jsonb,
  p_owned_cores jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_status text;
  v_generation dna.dna_open_lab_sync_generation%ROWTYPE;
  v_row jsonb;
  v_key_count integer;
  v_core_count integer;
  v_expected_core_count bigint;
  v_source_core_id bigint;
  v_f_number integer;
  v_display_name text;
  v_color text;
  v_row_observed_at timestamptz;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab materialization denied';
  END IF;
  IF jsonb_typeof(p_owned_cores) <> 'array'
     OR jsonb_array_length(p_owned_cores) > 10000 THEN
    RAISE EXCEPTION 'DNA Open Lab owned Core snapshot is invalid';
  END IF;
  IF jsonb_typeof(p_families) <> 'object'
     OR jsonb_typeof(p_families -> 'cores') <> 'object'
     OR jsonb_typeof(p_families -> 'cores' -> 'itemCount') <> 'number'
     OR p_families -> 'cores' ->> 'itemCount' !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DNA Open Lab Core family count is invalid';
  END IF;
  v_expected_core_count := (p_families -> 'cores' ->> 'itemCount')::bigint;
  v_core_count := jsonb_array_length(p_owned_cores);
  IF v_expected_core_count <> v_core_count THEN
    RAISE EXCEPTION 'DNA Open Lab owned Core count does not match family receipt';
  END IF;

  IF (
    SELECT count(*) FROM (
      SELECT DISTINCT value ->> 'sourceCoreId'
      FROM jsonb_array_elements(p_owned_cores)
    ) unique_core_ids
  ) <> v_core_count THEN
    RAISE EXCEPTION 'DNA Open Lab owned Core snapshot contains duplicate IDs';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_owned_cores)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core row is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_row);
    IF v_key_count <> 9 OR NOT (
      v_row ? 'sourceCoreId' AND v_row ? 'displayName'
      AND v_row ? 'coreClass' AND v_row ? 'element'
      AND v_row ? 'fNumber' AND v_row ? 'sex'
      AND v_row ? 'colorSourceValue' AND v_row ? 'observedAt'
      AND v_row ? 'rawEvidenceSha256'
    ) THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core row fields are invalid';
    END IF;
    IF jsonb_typeof(v_row -> 'sourceCoreId') <> 'string'
       OR v_row ->> 'sourceCoreId' !~ '^[1-9][0-9]*$'
       OR length(v_row ->> 'sourceCoreId') > 16
       OR jsonb_typeof(v_row -> 'displayName') <> 'string'
       OR jsonb_typeof(v_row -> 'coreClass') <> 'string'
       OR jsonb_typeof(v_row -> 'element') <> 'string'
       OR jsonb_typeof(v_row -> 'fNumber') <> 'number'
       OR v_row ->> 'fNumber' !~ '^[1-9][0-9]*$'
       OR jsonb_typeof(v_row -> 'sex') <> 'string'
       OR jsonb_typeof(v_row -> 'observedAt') <> 'string'
       OR jsonb_typeof(v_row -> 'rawEvidenceSha256') <> 'string'
       OR NOT (
         jsonb_typeof(v_row -> 'colorSourceValue') = 'null'
         OR jsonb_typeof(v_row -> 'colorSourceValue') = 'string'
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core row types are invalid';
    END IF;
    v_source_core_id := (v_row ->> 'sourceCoreId')::bigint;
    v_f_number := (v_row ->> 'fNumber')::integer;
    v_display_name := v_row ->> 'displayName';
    v_color := v_row ->> 'colorSourceValue';
    BEGIN
      v_row_observed_at := (v_row ->> 'observedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core observation time is invalid';
    END;
    IF v_source_core_id NOT BETWEEN 1 AND 9007199254740991
       OR v_f_number NOT BETWEEN 1 AND 1000000
       OR length(v_display_name) NOT BETWEEN 1 AND 256
       OR v_display_name ~ '[[:cntrl:]]'
       OR v_row ->> 'coreClass' NOT IN ('Genesis', 'Morphed', 'Freak', 'X-Class')
       OR v_row ->> 'element' NOT IN ('Metal', 'Fire', 'Earth', 'Water')
       OR v_row ->> 'sex' NOT IN ('male', 'female')
       OR (v_color IS NOT NULL AND (
         length(v_color) NOT BETWEEN 1 AND 256 OR v_color ~ '[[:cntrl:]]'
       ))
       OR v_row_observed_at > p_observed_at
       OR v_row ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core row is out of bounds';
    END IF;
  END LOOP;

  v_status := dna.stage_dna_open_lab_sync_candidate(
    p_owner_id, p_generation_id, p_observed_at, p_recorded_at, p_families
  );
  SELECT generation.* INTO v_generation
  FROM dna.dna_open_lab_sync_generation generation
  WHERE generation.owner_id = p_owner_id AND generation.id = p_generation_id
  FOR UPDATE;

  IF v_status = 'published' THEN
    IF v_generation.materialization_contract_version <> 1
       OR (
         SELECT count(*) FROM dna.dna_open_lab_owned_core_snapshot stored
         WHERE stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
       ) <> v_core_count
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_owned_cores) requested
         LEFT JOIN dna.dna_open_lab_owned_core_snapshot stored
           ON stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
           AND stored.source_core_id = (requested ->> 'sourceCoreId')::bigint
         WHERE stored.source_core_id IS NULL
           OR stored.display_name <> requested ->> 'displayName'
           OR stored.core_class <> requested ->> 'coreClass'
           OR stored.element <> requested ->> 'element'
           OR stored.f_number <> (requested ->> 'fNumber')::integer
           OR stored.sex <> requested ->> 'sex'
           OR stored.color_source_value IS DISTINCT FROM requested ->> 'colorSourceValue'
           OR stored.observed_at <> (requested ->> 'observedAt')::timestamptz
           OR stored.raw_evidence_sha256 <> requested ->> 'rawEvidenceSha256'
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab published materialization replay conflict';
    END IF;
    RETURN 'published';
  END IF;

  DELETE FROM dna.dna_open_lab_owned_core_snapshot
  WHERE owner_id = p_owner_id AND generation_id = p_generation_id;
  INSERT INTO dna.dna_open_lab_owned_core_snapshot (
    owner_id, generation_id, source_core_id, display_name, core_class,
    element, f_number, sex, color_source_value, observed_at,
    raw_evidence_sha256
  )
  SELECT
    p_owner_id, p_generation_id, (entry ->> 'sourceCoreId')::bigint,
    entry ->> 'displayName', entry ->> 'coreClass', entry ->> 'element',
    (entry ->> 'fNumber')::integer, entry ->> 'sex',
    entry ->> 'colorSourceValue', (entry ->> 'observedAt')::timestamptz,
    (entry ->> 'rawEvidenceSha256')::character(64)
  FROM jsonb_array_elements(p_owned_cores) entry;

  UPDATE dna.dna_open_lab_sync_generation
  SET materialization_contract_version = 1
  WHERE owner_id = p_owner_id AND id = p_generation_id;
  RETURN 'staged';
END
$function$;

CREATE FUNCTION dna.enforce_dna_open_lab_materialized_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_expected_core_count bigint;
  v_actual_core_count bigint;
BEGIN
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version = 1 THEN
    SELECT family.item_count INTO v_expected_core_count
    FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id
      AND family.generation_id = NEW.id
      AND family.family = 'cores'
      AND family.status = 'complete';
    SELECT count(*) INTO v_actual_core_count
    FROM dna.dna_open_lab_owned_core_snapshot core
    WHERE core.owner_id = NEW.owner_id AND core.generation_id = NEW.id;
    IF v_expected_core_count IS NULL
       OR v_expected_core_count <> v_actual_core_count THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core materialization is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER enforce_dna_open_lab_materialized_publication
BEFORE UPDATE OF status ON dna.dna_open_lab_sync_generation
FOR EACH ROW
EXECUTE FUNCTION dna.enforce_dna_open_lab_materialized_publication();

CREATE FUNCTION dna.read_dna_open_lab_serving_owned_cores(p_owner_id uuid)
RETURNS TABLE (
  owner_id uuid,
  generation_id uuid,
  source_core_id bigint,
  display_name text,
  core_class text,
  element text,
  f_number integer,
  sex text,
  color_source_value text,
  observed_at timestamptz,
  raw_evidence_sha256 character(64)
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab owned Core read denied';
  END IF;
  RETURN QUERY
  SELECT core.owner_id, core.generation_id, core.source_core_id,
    core.display_name, core.core_class, core.element, core.f_number, core.sex,
    core.color_source_value, core.observed_at, core.raw_evidence_sha256
  FROM dna.dna_open_lab_sync_state state
  JOIN dna.dna_open_lab_owned_core_snapshot core
    ON core.owner_id = state.owner_id
    AND core.generation_id = state.serving_generation_id
  WHERE state.owner_id = p_owner_id
  ORDER BY core.source_core_id;
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_owned_core_snapshot FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.stage_dna_open_lab_materialized_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.enforce_dna_open_lab_materialized_publication()
FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_serving_owned_cores(uuid)
FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION dna.stage_dna_open_lab_sync_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb
) FROM dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.stage_dna_open_lab_materialized_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_owned_cores(uuid)
TO dna_app_runtime;

COMMIT;

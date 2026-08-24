BEGIN;

CREATE TABLE dna.race_archive_core_locator (
  owner_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_core_id text NOT NULL CHECK (
    length(source_core_id) BETWEEN 1 AND 512
    AND source_core_id !~ '[[:cntrl:]]'
  ),
  partition_numbers integer[] NOT NULL CHECK (
    cardinality(partition_numbers) BETWEEN 1 AND 10000
  ),
  ready_row_count bigint NOT NULL CHECK (ready_row_count > 0),
  first_source_row_number bigint NOT NULL CHECK (first_source_row_number > 0),
  last_source_row_number bigint NOT NULL CHECK (
    last_source_row_number >= first_source_row_number
  ),
  built_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, dataset_version_id, source_core_id),
  FOREIGN KEY (owner_id, dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX race_archive_core_locator_core_lookup
  ON dna.race_archive_core_locator(owner_id, source_core_id, dataset_version_id);

CREATE TABLE dna.race_archive_core_locator_receipt (
  owner_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  locator_set_sha256 character(64) NOT NULL CHECK (
    locator_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  core_locator_count integer NOT NULL CHECK (
    core_locator_count BETWEEN 1 AND 50000
  ),
  ready_row_count bigint NOT NULL CHECK (ready_row_count > 0),
  partition_reference_count bigint NOT NULL CHECK (
    partition_reference_count > 0
  ),
  built_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, dataset_version_id),
  UNIQUE (owner_id, import_batch_id),
  FOREIGN KEY (owner_id, dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE
);

ALTER TABLE dna.race_archive_core_locator ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_archive_core_locator FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_archive_core_locator
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.race_archive_core_locator_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_archive_core_locator_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_archive_core_locator_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.replace_race_archive_core_locators(
  p_owner_id uuid,
  p_dataset_version_id uuid,
  p_import_batch_id uuid,
  p_locator_set_sha256 character(64),
  p_locators jsonb,
  p_built_at timestamptz
)
RETURNS TABLE (
  status text,
  core_locator_count integer,
  ready_row_count bigint,
  partition_reference_count bigint,
  built_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_version dna.dataset_version%ROWTYPE;
  v_batch dna.import_batch%ROWTYPE;
  v_receipt dna.race_archive_core_locator_receipt%ROWTYPE;
  v_locator_count integer;
  v_distinct_core_count integer;
  v_ready_row_count bigint;
  v_partition_reference_count bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive Core locator replacement denied';
  END IF;
  IF p_locator_set_sha256 IS NULL
     OR p_locator_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive Core locator set checksum is invalid';
  END IF;
  IF p_built_at IS NULL THEN
    RAISE EXCEPTION 'Race archive Core locator build timestamp is required';
  END IF;
  IF jsonb_typeof(p_locators) <> 'array' THEN
    RAISE EXCEPTION 'Race archive Core locators must be a JSON array';
  END IF;

  SELECT version.* INTO v_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_version.source_type <> 'race_merge'
     OR v_version.import_batch_id <> p_import_batch_id
     OR v_version.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'owner-scoped unrolled Race Merge dataset version is unavailable';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
    AND batch.source_type = 'race_merge'
  FOR UPDATE;

  IF NOT FOUND OR v_batch.status <> 'accepted' THEN
    RAISE EXCEPTION 'accepted owner-scoped Race Merge batch is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version_evidence_receipt evidence
    WHERE evidence.owner_id = p_owner_id
      AND evidence.dataset_version_id = p_dataset_version_id
      AND evidence.import_batch_id = p_import_batch_id
      AND evidence.source_type = 'race_merge'
      AND evidence.evidence_partition_count BETWEEN 1 AND 10000
      AND evidence.evidence_row_count = v_batch.source_rows
      AND evidence.evidence_byte_size > 0
  ) THEN
    RAISE EXCEPTION 'sealed Race archive evidence is unavailable';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM dna.race_archive_core_locator_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.dataset_version_id = p_dataset_version_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_receipt.import_batch_id <> p_import_batch_id
       OR v_receipt.locator_set_sha256 <> p_locator_set_sha256 THEN
      RAISE EXCEPTION 'Race archive Core locator replay conflict';
    END IF;
    RETURN QUERY SELECT
      'existing'::text,
      v_receipt.core_locator_count,
      v_receipt.ready_row_count,
      v_receipt.partition_reference_count,
      v_receipt.built_at;
    RETURN;
  END IF;

  v_locator_count := jsonb_array_length(p_locators);
  IF v_locator_count NOT BETWEEN 1 AND 50000 THEN
    RAISE EXCEPTION 'Race archive Core locator count is outside its bound';
  END IF;

  WITH parsed AS (
    SELECT
      locator.source_core_id,
      locator.partition_numbers,
      locator.ready_row_count,
      locator.first_source_row_number,
      locator.last_source_row_number
    FROM jsonb_to_recordset(p_locators) AS locator(
      source_core_id text,
      partition_numbers integer[],
      ready_row_count bigint,
      first_source_row_number bigint,
      last_source_row_number bigint
    )
  )
  SELECT
    count(DISTINCT source_core_id)::integer,
    COALESCE(sum(ready_row_count), 0)::bigint,
    COALESCE(sum(cardinality(partition_numbers)), 0)::bigint
  INTO
    v_distinct_core_count,
    v_ready_row_count,
    v_partition_reference_count
  FROM parsed;

  IF v_distinct_core_count <> v_locator_count THEN
    RAISE EXCEPTION 'Race archive Core locators contain duplicate Core IDs';
  END IF;
  IF v_ready_row_count <= 0 OR v_ready_row_count > v_batch.source_rows THEN
    RAISE EXCEPTION 'Race archive Core locator row coverage is invalid';
  END IF;
  IF v_partition_reference_count <= 0 THEN
    RAISE EXCEPTION 'Race archive Core locator partition coverage is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_locators) AS locator(
      source_core_id text,
      partition_numbers integer[],
      ready_row_count bigint,
      first_source_row_number bigint,
      last_source_row_number bigint
    )
    WHERE locator.source_core_id IS NULL
      OR length(locator.source_core_id) NOT BETWEEN 1 AND 512
      OR locator.source_core_id ~ '[[:cntrl:]]'
      OR locator.partition_numbers IS NULL
      OR cardinality(locator.partition_numbers) NOT BETWEEN 1 AND 10000
      OR locator.ready_row_count IS NULL
      OR locator.ready_row_count <= 0
      OR locator.first_source_row_number IS NULL
      OR locator.first_source_row_number <= 0
      OR locator.last_source_row_number IS NULL
      OR locator.last_source_row_number < locator.first_source_row_number
      OR EXISTS (
        SELECT 1
        FROM unnest(locator.partition_numbers) AS partition_number
        WHERE partition_number IS NULL OR partition_number < 0
      )
      OR cardinality(locator.partition_numbers) <> (
        SELECT count(DISTINCT partition_number)::integer
        FROM unnest(locator.partition_numbers) AS partition_number
      )
      OR locator.partition_numbers <> (
        SELECT array_agg(partition_number ORDER BY partition_number)
        FROM unnest(locator.partition_numbers) AS partition_number
      )
  ) THEN
    RAISE EXCEPTION 'Race archive Core locator payload is invalid';
  END IF;

  INSERT INTO dna.race_archive_core_locator (
    owner_id,
    dataset_version_id,
    import_batch_id,
    source_core_id,
    partition_numbers,
    ready_row_count,
    first_source_row_number,
    last_source_row_number,
    built_at
  )
  SELECT
    p_owner_id,
    p_dataset_version_id,
    p_import_batch_id,
    locator.source_core_id,
    locator.partition_numbers,
    locator.ready_row_count,
    locator.first_source_row_number,
    locator.last_source_row_number,
    p_built_at
  FROM jsonb_to_recordset(p_locators) AS locator(
    source_core_id text,
    partition_numbers integer[],
    ready_row_count bigint,
    first_source_row_number bigint,
    last_source_row_number bigint
  );

  INSERT INTO dna.race_archive_core_locator_receipt (
    owner_id,
    dataset_version_id,
    import_batch_id,
    locator_set_sha256,
    core_locator_count,
    ready_row_count,
    partition_reference_count,
    built_at
  ) VALUES (
    p_owner_id,
    p_dataset_version_id,
    p_import_batch_id,
    p_locator_set_sha256,
    v_locator_count,
    v_ready_row_count,
    v_partition_reference_count,
    p_built_at
  );

  RETURN QUERY SELECT
    'sealed'::text,
    v_locator_count,
    v_ready_row_count,
    v_partition_reference_count,
    p_built_at;
END
$function$;

CREATE FUNCTION dna.list_race_archive_core_locators(
  p_owner_id uuid,
  p_source_core_id text,
  p_maximum_versions integer
)
RETURNS TABLE (
  dataset_version_id uuid,
  import_batch_id uuid,
  version_number bigint,
  partition_numbers integer[],
  ready_row_count bigint,
  first_source_row_number bigint,
  last_source_row_number bigint,
  built_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_available_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive Core locator read denied';
  END IF;
  IF p_source_core_id IS NULL
     OR length(p_source_core_id) NOT BETWEEN 1 AND 512
     OR p_source_core_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Race archive source Core ID is invalid';
  END IF;
  IF p_maximum_versions NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Race archive Core locator version bound is invalid';
  END IF;

  SELECT count(*)::integer INTO v_available_count
  FROM dna.race_archive_core_locator locator
  JOIN dna.race_archive_core_locator_receipt receipt
    ON receipt.owner_id = locator.owner_id
    AND receipt.dataset_version_id = locator.dataset_version_id
    AND receipt.import_batch_id = locator.import_batch_id
  JOIN dna.dataset_version version
    ON version.owner_id = locator.owner_id
    AND version.id = locator.dataset_version_id
    AND version.import_batch_id = locator.import_batch_id
  JOIN dna.dataset_version active_version
    ON active_version.owner_id = version.owner_id
    AND active_version.source_type = 'race_merge'
    AND active_version.is_active
    AND active_version.rolled_back_at IS NULL
  WHERE locator.owner_id = p_owner_id
    AND locator.source_core_id = p_source_core_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= active_version.version_number;

  IF v_available_count > p_maximum_versions THEN
    RAISE EXCEPTION 'Race archive Core locator history exceeds the read bound';
  END IF;

  RETURN QUERY
  SELECT
    locator.dataset_version_id,
    locator.import_batch_id,
    version.version_number,
    locator.partition_numbers,
    locator.ready_row_count,
    locator.first_source_row_number,
    locator.last_source_row_number,
    locator.built_at
  FROM dna.race_archive_core_locator locator
  JOIN dna.race_archive_core_locator_receipt receipt
    ON receipt.owner_id = locator.owner_id
    AND receipt.dataset_version_id = locator.dataset_version_id
    AND receipt.import_batch_id = locator.import_batch_id
  JOIN dna.dataset_version version
    ON version.owner_id = locator.owner_id
    AND version.id = locator.dataset_version_id
    AND version.import_batch_id = locator.import_batch_id
  JOIN dna.dataset_version active_version
    ON active_version.owner_id = version.owner_id
    AND active_version.source_type = 'race_merge'
    AND active_version.is_active
    AND active_version.rolled_back_at IS NULL
  WHERE locator.owner_id = p_owner_id
    AND locator.source_core_id = p_source_core_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= active_version.version_number
  ORDER BY version.version_number, locator.dataset_version_id;
END
$function$;

REVOKE ALL ON TABLE dna.race_archive_core_locator FROM PUBLIC;
REVOKE ALL ON TABLE dna.race_archive_core_locator_receipt FROM PUBLIC;
REVOKE ALL ON TABLE dna.race_archive_core_locator FROM dna_app_runtime;
REVOKE ALL ON TABLE dna.race_archive_core_locator_receipt FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_race_archive_core_locators(
  uuid, text, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.list_race_archive_core_locators(
  uuid, text, integer
) TO dna_app_runtime;

COMMIT;
BEGIN;

CREATE TABLE dna.normalized_analytical_artifact (
  id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  import_batch_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_arena')
  ),
  artifact_format text NOT NULL CHECK (
    artifact_format = 'parquet/v1'
  ),
  storage_provider text NOT NULL CHECK (
    storage_provider = 'cloudflare_r2'
  ),
  object_id text NOT NULL CHECK (
    object_id = btrim(object_id)
    AND length(object_id) BETWEEN 1 AND 512
    AND object_id !~ '[[:cntrl:]]'
    AND position('://' in object_id) = 0
  ),
  content_sha256 character(64) NOT NULL CHECK (
    content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  source_row_count bigint NOT NULL CHECK (source_row_count >= 0),
  ready_row_count bigint NOT NULL CHECK (ready_row_count >= 0),
  quarantined_row_count bigint NOT NULL CHECK (quarantined_row_count >= 0),
  warning_row_count bigint NOT NULL CHECK (warning_row_count >= 0),
  natural_key_set_sha256 character(64) NOT NULL CHECK (
    natural_key_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  minimum_event_at timestamptz,
  maximum_event_at timestamptz,
  state text NOT NULL CHECK (state IN ('prepared', 'bound', 'rolled_back')),
  dataset_version_id uuid,
  prepared_at timestamptz NOT NULL,
  bound_at timestamptz,
  rolled_back_at timestamptz,
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, import_batch_id),
  UNIQUE (owner_id, storage_provider, object_id),
  FOREIGN KEY (owner_id, import_batch_id, source_type)
    REFERENCES dna.import_batch(owner_id, id, source_type)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_id, dataset_version_id, source_type)
    REFERENCES dna.dataset_version(owner_id, id, source_type)
    ON DELETE CASCADE,
  CHECK (ready_row_count + quarantined_row_count = source_row_count),
  CHECK (warning_row_count <= source_row_count),
  CHECK (
    (minimum_event_at IS NULL AND maximum_event_at IS NULL)
    OR (
      minimum_event_at IS NOT NULL
      AND maximum_event_at IS NOT NULL
      AND maximum_event_at >= minimum_event_at
    )
  ),
  CHECK (
    (source_type = 'race_merge')
    OR (minimum_event_at IS NULL AND maximum_event_at IS NULL)
  ),
  CHECK (
    (state = 'prepared'
      AND dataset_version_id IS NULL
      AND bound_at IS NULL
      AND rolled_back_at IS NULL)
    OR
    (state = 'bound'
      AND dataset_version_id IS NOT NULL
      AND bound_at IS NOT NULL
      AND rolled_back_at IS NULL)
    OR
    (state = 'rolled_back'
      AND dataset_version_id IS NOT NULL
      AND bound_at IS NOT NULL
      AND rolled_back_at IS NOT NULL)
  )
);

CREATE INDEX normalized_analytical_artifact_version
  ON dna.normalized_analytical_artifact(
    owner_id, dataset_version_id, source_type
  )
  WHERE dataset_version_id IS NOT NULL;

ALTER TABLE dna.normalized_analytical_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.normalized_analytical_artifact FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.normalized_analytical_artifact
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.register_normalized_analytical_artifact(
  p_owner_id uuid,
  p_import_batch_id uuid,
  p_source_type text,
  p_object_id text,
  p_content_sha256 character(64),
  p_byte_length bigint,
  p_source_row_count bigint,
  p_ready_row_count bigint,
  p_quarantined_row_count bigint,
  p_warning_row_count bigint,
  p_natural_key_set_sha256 character(64),
  p_minimum_event_at timestamptz,
  p_maximum_event_at timestamptz,
  p_prepared_at timestamptz
)
RETURNS TABLE (
  disposition text,
  artifact_id uuid,
  artifact_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch dna.import_batch%ROWTYPE;
  v_existing dna.normalized_analytical_artifact%ROWTYPE;
  v_artifact_id uuid := md5(
    p_owner_id::text || ':normalized_analytical_artifact:' ||
    p_import_batch_id::text
  )::uuid;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped normalized artifact registration denied';
  END IF;
  IF p_prepared_at IS NULL THEN
    RAISE EXCEPTION 'normalized artifact preparation timestamp is required';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
    AND batch.source_type = p_source_type
    AND batch.status IN ('validating', 'accepted')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped import batch is unavailable for normalized artifact';
  END IF;

  IF p_source_row_count <> v_batch.source_rows
     OR p_ready_row_count + p_quarantined_row_count <> p_source_row_count
     OR p_warning_row_count > p_source_row_count THEN
    RAISE EXCEPTION 'normalized artifact row evidence does not match import batch';
  END IF;

  SELECT artifact.* INTO v_existing
  FROM dna.normalized_analytical_artifact artifact
  WHERE artifact.owner_id = p_owner_id
    AND artifact.import_batch_id = p_import_batch_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.source_type <> p_source_type
       OR v_existing.artifact_format <> 'parquet/v1'
       OR v_existing.storage_provider <> 'cloudflare_r2'
       OR v_existing.object_id <> btrim(p_object_id)
       OR v_existing.content_sha256 <> p_content_sha256
       OR v_existing.byte_length <> p_byte_length
       OR v_existing.source_row_count <> p_source_row_count
       OR v_existing.ready_row_count <> p_ready_row_count
       OR v_existing.quarantined_row_count <> p_quarantined_row_count
       OR v_existing.warning_row_count <> p_warning_row_count
       OR v_existing.natural_key_set_sha256 <> p_natural_key_set_sha256
       OR v_existing.minimum_event_at IS DISTINCT FROM p_minimum_event_at
       OR v_existing.maximum_event_at IS DISTINCT FROM p_maximum_event_at THEN
      RAISE EXCEPTION 'normalized artifact idempotency conflict';
    END IF;

    RETURN QUERY SELECT 'existing'::text, v_existing.id, v_existing.state;
    RETURN;
  END IF;

  INSERT INTO dna.normalized_analytical_artifact (
    id, owner_id, import_batch_id, source_type, artifact_format,
    storage_provider, object_id, content_sha256, byte_length,
    source_row_count, ready_row_count, quarantined_row_count,
    warning_row_count, natural_key_set_sha256, minimum_event_at,
    maximum_event_at, state, prepared_at
  ) VALUES (
    v_artifact_id, p_owner_id, p_import_batch_id, p_source_type,
    'parquet/v1', 'cloudflare_r2', btrim(p_object_id), p_content_sha256,
    p_byte_length, p_source_row_count, p_ready_row_count,
    p_quarantined_row_count, p_warning_row_count,
    p_natural_key_set_sha256, p_minimum_event_at, p_maximum_event_at,
    'prepared', p_prepared_at
  );

  RETURN QUERY SELECT 'created'::text, v_artifact_id, 'prepared'::text;
END
$function$;

CREATE FUNCTION dna.bind_normalized_analytical_artifact(
  p_owner_id uuid,
  p_import_batch_id uuid,
  p_dataset_version_id uuid,
  p_bound_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_artifact dna.normalized_analytical_artifact%ROWTYPE;
  v_version dna.dataset_version%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped normalized artifact binding denied';
  END IF;
  IF p_bound_at IS NULL THEN
    RAISE EXCEPTION 'normalized artifact binding timestamp is required';
  END IF;

  SELECT artifact.* INTO v_artifact
  FROM dna.normalized_analytical_artifact artifact
  WHERE artifact.owner_id = p_owner_id
    AND artifact.import_batch_id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'normalized analytical artifact is unavailable';
  END IF;

  SELECT version.* INTO v_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.import_batch_id = p_import_batch_id
    AND version.source_type = v_artifact.source_type
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'matching dataset version is unavailable for normalized artifact';
  END IF;

  IF v_artifact.state = 'bound' THEN
    IF v_artifact.dataset_version_id <> p_dataset_version_id THEN
      RAISE EXCEPTION 'normalized artifact binding conflict';
    END IF;
    RETURN;
  END IF;

  IF v_artifact.state <> 'prepared' THEN
    RAISE EXCEPTION 'rolled-back normalized artifact cannot be rebound';
  END IF;

  UPDATE dna.normalized_analytical_artifact
  SET state = 'bound', dataset_version_id = p_dataset_version_id,
      bound_at = p_bound_at
  WHERE owner_id = p_owner_id AND id = v_artifact.id;
END
$function$;

CREATE FUNCTION dna.rollback_normalized_analytical_artifact(
  p_owner_id uuid,
  p_dataset_version_id uuid,
  p_rolled_back_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped normalized artifact rollback denied';
  END IF;
  IF p_rolled_back_at IS NULL THEN
    RAISE EXCEPTION 'normalized artifact rollback timestamp is required';
  END IF;

  UPDATE dna.normalized_analytical_artifact
  SET state = 'rolled_back', rolled_back_at = p_rolled_back_at
  WHERE owner_id = p_owner_id
    AND dataset_version_id = p_dataset_version_id
    AND state = 'bound';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM dna.normalized_analytical_artifact artifact
    WHERE artifact.owner_id = p_owner_id
      AND artifact.dataset_version_id = p_dataset_version_id
      AND artifact.state = 'rolled_back'
  ) THEN
    RAISE EXCEPTION 'bound normalized analytical artifact is unavailable';
  END IF;
END
$function$;

REVOKE ALL ON TABLE dna.normalized_analytical_artifact FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.register_normalized_analytical_artifact(
  uuid, uuid, text, text, character, bigint, bigint, bigint, bigint,
  bigint, character, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.bind_normalized_analytical_artifact(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_normalized_analytical_artifact(
  uuid, uuid, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.normalized_analytical_artifact TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.register_normalized_analytical_artifact(
  uuid, uuid, text, text, character, bigint, bigint, bigint, bigint,
  bigint, character, timestamptz, timestamptz, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.bind_normalized_analytical_artifact(
  uuid, uuid, uuid, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.rollback_normalized_analytical_artifact(
  uuid, uuid, timestamptz
) TO dna_app_runtime;

COMMIT;

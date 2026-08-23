BEGIN;

CREATE TABLE dna.dataset_evidence_object (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  import_batch_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_arena')
  ),
  object_kind text NOT NULL CHECK (
    object_kind IN (
      'staged_rows',
      'accepted_contributions',
      'normalized_partition'
    )
  ),
  partition_number integer NOT NULL CHECK (
    partition_number BETWEEN 0 AND 9999
  ),
  object_format text NOT NULL CHECK (
    object_format IN ('ndjson_gzip', 'parquet')
  ),
  object_key text NOT NULL CHECK (
    object_key = btrim(object_key)
    AND length(object_key) BETWEEN 1 AND 1024
    AND object_key !~ '[[:cntrl:]]'
  ),
  checksum_sha256 character(64) NOT NULL CHECK (
    checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  row_count bigint NOT NULL CHECK (row_count > 0),
  first_natural_key text,
  last_natural_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, import_batch_id, object_kind, partition_number),
  UNIQUE (owner_id, object_key),
  FOREIGN KEY (owner_id, import_batch_id, source_type)
    REFERENCES dna.import_batch(owner_id, id, source_type)
    ON DELETE CASCADE,
  CHECK (
    (first_natural_key IS NULL) = (last_natural_key IS NULL)
  ),
  CHECK (
    first_natural_key IS NULL
    OR (
      length(first_natural_key) BETWEEN 1 AND 512
      AND length(last_natural_key) BETWEEN 1 AND 512
      AND first_natural_key !~ '[[:cntrl:]]'
      AND last_natural_key !~ '[[:cntrl:]]'
    )
  )
);

ALTER TABLE dna.dataset_evidence_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dataset_evidence_object FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.dataset_evidence_object
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.register_dataset_evidence_object(
  p_owner_id uuid,
  p_import_batch_id uuid,
  p_source_type text,
  p_object_kind text,
  p_partition_number integer,
  p_object_format text,
  p_object_key text,
  p_checksum_sha256 character(64),
  p_byte_size bigint,
  p_row_count bigint,
  p_first_natural_key text,
  p_last_natural_key text,
  p_created_at timestamptz
)
RETURNS TABLE (
  status text,
  evidence_object_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dataset_evidence_object%ROWTYPE;
  v_batch dna.import_batch%ROWTYPE;
  v_id uuid := md5(
    p_owner_id::text || ':evidence_object:' ||
    p_import_batch_id::text || ':' || p_object_kind || ':' ||
    p_partition_number::text
  )::uuid;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped evidence object registration denied';
  END IF;
  IF p_created_at IS NULL THEN
    RAISE EXCEPTION 'evidence object creation timestamp is required';
  END IF;

  SELECT object.* INTO v_existing
  FROM dna.dataset_evidence_object object
  WHERE object.owner_id = p_owner_id
    AND object.import_batch_id = p_import_batch_id
    AND object.object_kind = p_object_kind
    AND object.partition_number = p_partition_number
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.source_type <> p_source_type
       OR v_existing.object_format <> p_object_format
       OR v_existing.object_key <> btrim(p_object_key)
       OR v_existing.checksum_sha256 <> p_checksum_sha256
       OR v_existing.byte_size <> p_byte_size
       OR v_existing.row_count <> p_row_count
       OR v_existing.first_natural_key IS DISTINCT FROM p_first_natural_key
       OR v_existing.last_natural_key IS DISTINCT FROM p_last_natural_key THEN
      RAISE EXCEPTION 'evidence object registration conflict';
    END IF;
    RETURN QUERY SELECT 'existing'::text, v_existing.id;
    RETURN;
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
    AND batch.source_type = p_source_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped import batch does not exist';
  END IF;
  IF v_batch.status NOT IN ('validating', 'accepted') THEN
    RAISE EXCEPTION 'evidence objects require a validating or accepted batch';
  END IF;

  INSERT INTO dna.dataset_evidence_object (
    id, owner_id, import_batch_id, source_type, object_kind,
    partition_number, object_format, object_key, checksum_sha256,
    byte_size, row_count, first_natural_key, last_natural_key, created_at
  ) VALUES (
    v_id, p_owner_id, p_import_batch_id, p_source_type, p_object_kind,
    p_partition_number, p_object_format, btrim(p_object_key),
    p_checksum_sha256, p_byte_size, p_row_count,
    p_first_natural_key, p_last_natural_key, p_created_at
  );

  RETURN QUERY SELECT 'created'::text, v_id;
END
$function$;

REVOKE ALL ON TABLE dna.dataset_evidence_object FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.register_dataset_evidence_object(
  uuid, uuid, text, text, integer, text, text, character,
  bigint, bigint, text, text, timestamptz
) FROM PUBLIC;
GRANT SELECT ON TABLE dna.dataset_evidence_object TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.register_dataset_evidence_object(
  uuid, uuid, text, text, integer, text, text, character,
  bigint, bigint, text, text, timestamptz
) TO dna_app_runtime;

COMMIT;

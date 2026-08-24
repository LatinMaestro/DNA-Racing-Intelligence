BEGIN;

CREATE TABLE dna.import_preview_evidence_receipt (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  import_batch_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_arena')
  ),
  object_kind text NOT NULL CHECK (object_kind = 'staged_rows'),
  partition_number integer NOT NULL CHECK (
    partition_number BETWEEN 0 AND 9999
  ),
  object_format text NOT NULL CHECK (object_format = 'ndjson_gzip'),
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
  object_created_at timestamptz NOT NULL,
  registered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, import_batch_id, object_kind, partition_number),
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

ALTER TABLE dna.import_preview_evidence_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_preview_evidence_receipt FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.import_preview_evidence_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.record_import_preview_evidence_receipts(
  p_owner_id uuid,
  p_import_batch_id uuid,
  p_receipts jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch dna.import_batch%ROWTYPE;
  v_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Preview evidence receipt recording denied';
  END IF;
  IF p_receipts IS NULL OR jsonb_typeof(p_receipts) <> 'array' THEN
    RAISE EXCEPTION 'Preview evidence receipts must be a JSON array';
  END IF;

  v_count := jsonb_array_length(p_receipts);
  IF v_count > 10000 THEN
    RAISE EXCEPTION 'Preview evidence receipt set exceeds configured capacity';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped Preview import batch does not exist';
  END IF;
  IF v_batch.status <> 'validating'
     OR v_batch.source_type NOT IN ('race_merge', 'core_details', 'current_arena') THEN
    RAISE EXCEPTION 'Preview evidence receipts require a validating imported batch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_receipts) AS receipt(
      "ownerId" text,
      "importBatchId" text,
      "sourceType" text,
      "objectKind" text,
      "partitionNumber" integer,
      "objectFormat" text,
      "objectKey" text,
      "checksumSha256" text,
      "byteSize" bigint,
      "rowCount" bigint,
      "firstNaturalKey" text,
      "lastNaturalKey" text,
      "createdAt" timestamptz
    )
    WHERE receipt."ownerId" IS NULL
       OR receipt."ownerId" <> p_owner_id::text
       OR receipt."importBatchId" IS NULL
       OR receipt."importBatchId" <> p_import_batch_id::text
       OR receipt."sourceType" IS NULL
       OR receipt."sourceType" <> v_batch.source_type
       OR receipt."objectKind" <> 'staged_rows'
       OR receipt."objectFormat" <> 'ndjson_gzip'
       OR receipt."partitionNumber" NOT BETWEEN 0 AND 9999
       OR receipt."objectKey" IS NULL
       OR receipt."objectKey" <> btrim(receipt."objectKey")
       OR length(receipt."objectKey") NOT BETWEEN 1 AND 1024
       OR receipt."objectKey" ~ '[[:cntrl:]]'
       OR receipt."checksumSha256" !~ '^[a-f0-9]{64}$'
       OR receipt."byteSize" <= 0
       OR receipt."rowCount" <= 0
       OR receipt."createdAt" IS NULL
       OR (receipt."firstNaturalKey" IS NULL) <>
          (receipt."lastNaturalKey" IS NULL)
       OR (
         receipt."firstNaturalKey" IS NOT NULL
         AND (
           length(receipt."firstNaturalKey") NOT BETWEEN 1 AND 512
           OR length(receipt."lastNaturalKey") NOT BETWEEN 1 AND 512
           OR receipt."firstNaturalKey" ~ '[[:cntrl:]]'
           OR receipt."lastNaturalKey" ~ '[[:cntrl:]]'
         )
       )
  ) THEN
    RAISE EXCEPTION 'Preview evidence receipt payload is invalid';
  END IF;

  IF (
    SELECT count(DISTINCT receipt."partitionNumber")
    FROM jsonb_to_recordset(p_receipts) AS receipt("partitionNumber" integer)
  ) <> v_count THEN
    RAISE EXCEPTION 'Preview evidence receipt set contains a duplicate partition';
  END IF;

  IF (
    SELECT count(DISTINCT receipt."objectKey")
    FROM jsonb_to_recordset(p_receipts) AS receipt("objectKey" text)
  ) <> v_count THEN
    RAISE EXCEPTION 'Preview evidence receipt set contains a duplicate object key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_receipts) AS receipt(
      "partitionNumber" integer,
      "sourceType" text,
      "objectKind" text,
      "objectFormat" text,
      "objectKey" text,
      "checksumSha256" text,
      "byteSize" bigint,
      "rowCount" bigint,
      "firstNaturalKey" text,
      "lastNaturalKey" text,
      "createdAt" timestamptz
    )
    JOIN dna.import_preview_evidence_receipt existing
      ON existing.owner_id = p_owner_id
      AND existing.import_batch_id = p_import_batch_id
      AND existing.object_kind = receipt."objectKind"
      AND existing.partition_number = receipt."partitionNumber"
    WHERE existing.source_type <> receipt."sourceType"
       OR existing.object_format <> receipt."objectFormat"
       OR existing.object_key <> receipt."objectKey"
       OR existing.checksum_sha256 <> receipt."checksumSha256"::character(64)
       OR existing.byte_size <> receipt."byteSize"
       OR existing.row_count <> receipt."rowCount"
       OR existing.first_natural_key IS DISTINCT FROM receipt."firstNaturalKey"
       OR existing.last_natural_key IS DISTINCT FROM receipt."lastNaturalKey"
       OR existing.object_created_at <> receipt."createdAt"
  ) THEN
    RAISE EXCEPTION 'Preview evidence receipt replay conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_receipts) AS receipt(
      "partitionNumber" integer,
      "objectKind" text,
      "objectKey" text
    )
    JOIN dna.import_preview_evidence_receipt existing
      ON existing.owner_id = p_owner_id
      AND existing.object_key = receipt."objectKey"
    WHERE existing.import_batch_id <> p_import_batch_id
       OR existing.object_kind <> receipt."objectKind"
       OR existing.partition_number <> receipt."partitionNumber"
  ) THEN
    RAISE EXCEPTION 'Preview evidence receipt object-key conflict';
  END IF;

  INSERT INTO dna.import_preview_evidence_receipt (
    owner_id, import_batch_id, source_type, object_kind, partition_number,
    object_format, object_key, checksum_sha256, byte_size, row_count,
    first_natural_key, last_natural_key, object_created_at
  )
  SELECT
    p_owner_id,
    p_import_batch_id,
    receipt."sourceType",
    receipt."objectKind",
    receipt."partitionNumber",
    receipt."objectFormat",
    receipt."objectKey",
    receipt."checksumSha256"::character(64),
    receipt."byteSize",
    receipt."rowCount",
    receipt."firstNaturalKey",
    receipt."lastNaturalKey",
    receipt."createdAt"
  FROM jsonb_to_recordset(p_receipts) AS receipt(
    "sourceType" text,
    "objectKind" text,
    "partitionNumber" integer,
    "objectFormat" text,
    "objectKey" text,
    "checksumSha256" text,
    "byteSize" bigint,
    "rowCount" bigint,
    "firstNaturalKey" text,
    "lastNaturalKey" text,
    "createdAt" timestamptz
  )
  ON CONFLICT (owner_id, import_batch_id, object_kind, partition_number)
  DO NOTHING;

  RETURN v_count;
END
$function$;

CREATE FUNCTION dna.finalize_import_preview_evidence_receipts(
  p_owner_id uuid,
  p_import_batch_ids uuid[],
  p_registered_at timestamptz
)
RETURNS TABLE (
  staged_batch_count integer,
  receipt_count integer,
  registered_manifest_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch_count integer;
  v_receipt_count integer;
  v_registered_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Preview evidence finalization denied';
  END IF;
  IF p_registered_at IS NULL THEN
    RAISE EXCEPTION 'Preview evidence finalization timestamp is required';
  END IF;
  IF p_import_batch_ids IS NULL
     OR cardinality(p_import_batch_ids) NOT BETWEEN 1 AND 24
     OR array_position(p_import_batch_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Preview evidence finalization batch set is invalid';
  END IF;
  IF (
    SELECT count(DISTINCT value)
    FROM unnest(p_import_batch_ids) value
  ) <> cardinality(p_import_batch_ids) THEN
    RAISE EXCEPTION 'Preview evidence finalization batch set contains duplicates';
  END IF;

  SELECT count(*)::integer INTO v_batch_count
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = ANY(p_import_batch_ids)
    AND batch.status = 'validating'
    AND batch.source_type IN ('race_merge', 'core_details', 'current_arena');

  IF v_batch_count <> cardinality(p_import_batch_ids) THEN
    RAISE EXCEPTION 'Preview evidence finalization batch set is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_batch batch
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(receipt.row_count), 0)::bigint AS evidence_rows
      FROM dna.import_preview_evidence_receipt receipt
      WHERE receipt.owner_id = batch.owner_id
        AND receipt.import_batch_id = batch.id
        AND receipt.source_type = batch.source_type
        AND receipt.object_kind = 'staged_rows'
    ) coverage ON true
    WHERE batch.owner_id = p_owner_id
      AND batch.id = ANY(p_import_batch_ids)
      AND coverage.evidence_rows <> batch.source_rows
  ) THEN
    RAISE EXCEPTION 'Preview evidence receipt coverage does not match staged rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_preview_evidence_receipt receipt
    JOIN dna.dataset_evidence_object object
      ON object.owner_id = receipt.owner_id
      AND object.import_batch_id = receipt.import_batch_id
      AND object.object_kind = receipt.object_kind
      AND object.partition_number = receipt.partition_number
    WHERE receipt.owner_id = p_owner_id
      AND receipt.import_batch_id = ANY(p_import_batch_ids)
      AND (
        object.source_type <> receipt.source_type
        OR object.object_format <> receipt.object_format
        OR object.object_key <> receipt.object_key
        OR object.checksum_sha256 <> receipt.checksum_sha256
        OR object.byte_size <> receipt.byte_size
        OR object.row_count <> receipt.row_count
        OR object.first_natural_key IS DISTINCT FROM receipt.first_natural_key
        OR object.last_natural_key IS DISTINCT FROM receipt.last_natural_key
        OR object.created_at <> receipt.object_created_at
      )
  ) THEN
    RAISE EXCEPTION 'Preview evidence manifest replay conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_preview_evidence_receipt receipt
    JOIN dna.dataset_evidence_object object
      ON object.owner_id = receipt.owner_id
      AND object.object_key = receipt.object_key
    WHERE receipt.owner_id = p_owner_id
      AND receipt.import_batch_id = ANY(p_import_batch_ids)
      AND (
        object.import_batch_id <> receipt.import_batch_id
        OR object.object_kind <> receipt.object_kind
        OR object.partition_number <> receipt.partition_number
      )
  ) THEN
    RAISE EXCEPTION 'Preview evidence manifest object-key conflict';
  END IF;

  INSERT INTO dna.dataset_evidence_object (
    id, owner_id, import_batch_id, source_type, object_kind,
    partition_number, object_format, object_key, checksum_sha256,
    byte_size, row_count, first_natural_key, last_natural_key, created_at
  )
  SELECT
    md5(
      receipt.owner_id::text || ':evidence_object:' ||
      receipt.import_batch_id::text || ':' || receipt.object_kind || ':' ||
      receipt.partition_number::text
    )::uuid,
    receipt.owner_id,
    receipt.import_batch_id,
    receipt.source_type,
    receipt.object_kind,
    receipt.partition_number,
    receipt.object_format,
    receipt.object_key,
    receipt.checksum_sha256,
    receipt.byte_size,
    receipt.row_count,
    receipt.first_natural_key,
    receipt.last_natural_key,
    receipt.object_created_at
  FROM dna.import_preview_evidence_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = ANY(p_import_batch_ids)
  ON CONFLICT (owner_id, import_batch_id, object_kind, partition_number)
  DO NOTHING;

  SELECT count(*)::integer INTO v_receipt_count
  FROM dna.import_preview_evidence_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = ANY(p_import_batch_ids);

  SELECT count(*)::integer INTO v_registered_count
  FROM dna.import_preview_evidence_receipt receipt
  JOIN dna.dataset_evidence_object object
    ON object.owner_id = receipt.owner_id
    AND object.import_batch_id = receipt.import_batch_id
    AND object.source_type = receipt.source_type
    AND object.object_kind = receipt.object_kind
    AND object.partition_number = receipt.partition_number
    AND object.object_format = receipt.object_format
    AND object.object_key = receipt.object_key
    AND object.checksum_sha256 = receipt.checksum_sha256
    AND object.byte_size = receipt.byte_size
    AND object.row_count = receipt.row_count
    AND object.first_natural_key IS NOT DISTINCT FROM receipt.first_natural_key
    AND object.last_natural_key IS NOT DISTINCT FROM receipt.last_natural_key
    AND object.created_at = receipt.object_created_at
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = ANY(p_import_batch_ids);

  IF v_registered_count <> v_receipt_count THEN
    RAISE EXCEPTION 'Preview evidence manifest finalization is incomplete';
  END IF;

  UPDATE dna.import_preview_evidence_receipt receipt
  SET registered_at = COALESCE(receipt.registered_at, p_registered_at)
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = ANY(p_import_batch_ids);

  RETURN QUERY SELECT v_batch_count, v_receipt_count, v_registered_count;
END
$function$;

REVOKE ALL ON TABLE dna.import_preview_evidence_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_import_preview_evidence_receipts(
  uuid, uuid, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.finalize_import_preview_evidence_receipts(
  uuid, uuid[], timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.import_preview_evidence_receipt TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_import_preview_evidence_receipts(
  uuid, uuid, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.finalize_import_preview_evidence_receipts(
  uuid, uuid[], timestamptz
) TO dna_app_runtime;

COMMIT;

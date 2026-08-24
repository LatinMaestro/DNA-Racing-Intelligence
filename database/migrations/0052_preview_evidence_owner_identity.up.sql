BEGIN;

CREATE OR REPLACE FUNCTION dna.record_import_preview_evidence_receipts(
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
  v_authenticated_owner_id text;
  v_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Preview evidence receipt recording denied';
  END IF;

  SELECT owner.clerk_user_id INTO v_authenticated_owner_id
  FROM dna.app_owner owner
  WHERE owner.id = p_owner_id;

  IF NOT FOUND OR v_authenticated_owner_id IS NULL OR btrim(v_authenticated_owner_id) = '' THEN
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
       OR receipt."ownerId" <> v_authenticated_owner_id
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

COMMIT;

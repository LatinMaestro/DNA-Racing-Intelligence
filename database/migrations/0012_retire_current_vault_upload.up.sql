BEGIN;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.import_upload_file
    WHERE source_family = 'current_vault'
  ) THEN
    RAISE EXCEPTION 'retired Current Vault uploads must be resolved before migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_upload_file
    GROUP BY owner_id, upload_batch_id
    HAVING count(*) > 8
  ) THEN
    RAISE EXCEPTION 'upload batches above the eight-file contract must be resolved before migration';
  END IF;
END
$preflight$;

ALTER TABLE dna.import_upload_file
  DROP CONSTRAINT import_upload_file_source_family_check;

ALTER TABLE dna.import_upload_file
  ADD CONSTRAINT import_upload_file_source_family_check CHECK (
    source_family IN ('race_merge', 'core_details', 'current_arena')
  );

CREATE FUNCTION dna.enforce_import_upload_batch_file_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      NEW.owner_id::text || ':import_upload_batch:' || NEW.upload_batch_id::text,
      0
    )
  );

  SELECT count(*)
  INTO v_existing_count
  FROM dna.import_upload_file file
  WHERE
    file.owner_id = NEW.owner_id
    AND file.upload_batch_id = NEW.upload_batch_id;

  IF v_existing_count >= 8 THEN
    RAISE EXCEPTION 'import upload batch exceeds the eight-file contract';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION dna.enforce_import_upload_batch_file_limit() FROM PUBLIC;

CREATE TRIGGER enforce_import_upload_batch_file_limit
BEFORE INSERT ON dna.import_upload_file
FOR EACH ROW
EXECUTE FUNCTION dna.enforce_import_upload_batch_file_limit();

COMMIT;

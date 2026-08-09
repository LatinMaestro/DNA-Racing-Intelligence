BEGIN;

DROP TRIGGER enforce_import_upload_batch_file_limit ON dna.import_upload_file;
DROP FUNCTION dna.enforce_import_upload_batch_file_limit();

ALTER TABLE dna.import_upload_file
  DROP CONSTRAINT import_upload_file_source_family_check;

ALTER TABLE dna.import_upload_file
  ADD CONSTRAINT import_upload_file_source_family_check CHECK (
    source_family IN (
      'race_merge',
      'core_details',
      'current_vault',
      'current_arena'
    )
  );

COMMIT;

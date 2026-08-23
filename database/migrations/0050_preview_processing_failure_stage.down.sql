BEGIN;

REVOKE ALL ON FUNCTION dna.record_import_preview_processing_failure(
  uuid, uuid, uuid, text, character, timestamptz, text
) FROM dna_app_runtime;
DROP FUNCTION dna.record_import_preview_processing_failure(
  uuid, uuid, uuid, text, character, timestamptz, text
);

ALTER TABLE dna.import_preview_processing
  DROP CONSTRAINT import_preview_processing_failure_reason_check;
ALTER TABLE dna.import_preview_processing
  ADD CONSTRAINT import_preview_processing_failure_reason_check
  CHECK (
    failure_reason IS NULL OR failure_reason = 'preview_processor_failed'
  );

COMMIT;

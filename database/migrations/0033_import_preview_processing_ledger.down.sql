BEGIN;
DROP FUNCTION IF EXISTS dna.record_import_preview_processing_failure(uuid, uuid, uuid, text, character, timestamptz);
DROP FUNCTION IF EXISTS dna.publish_import_prepared_preview(uuid, uuid, uuid, character, character, text, character, integer, integer, integer, boolean, timestamptz);
DROP FUNCTION IF EXISTS dna.claim_import_preview_dispatch(uuid, uuid, text, character, timestamptz, timestamptz);
DROP TABLE IF EXISTS dna.import_prepared_preview;
DROP TABLE IF EXISTS dna.import_preview_processing;
COMMIT;

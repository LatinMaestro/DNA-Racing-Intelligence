BEGIN;

DROP FUNCTION IF EXISTS dna.rollback_active_source_version(
  uuid, uuid, text, text, timestamptz
);
DROP TABLE IF EXISTS dna.import_dataset_rollback;

COMMIT;

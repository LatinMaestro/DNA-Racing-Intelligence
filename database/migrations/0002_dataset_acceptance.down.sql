BEGIN;

DROP FUNCTION IF EXISTS dna.rollback_active_dataset(text, text, timestamptz);
DROP FUNCTION IF EXISTS dna.accept_staged_dataset(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
);

DROP VIEW IF EXISTS dna.active_dataset_record;

DROP TABLE IF EXISTS dna.dataset_record_contribution;
DROP TABLE IF EXISTS dna.dataset_version_record;
DROP TABLE IF EXISTS dna.dataset_staged_record;
DROP TABLE IF EXISTS dna.dataset_stream;

ALTER TABLE dna.dataset_version
  DROP CONSTRAINT IF EXISTS dataset_version_owner_batch_unique;
ALTER TABLE dna.dataset_version
  DROP CONSTRAINT IF EXISTS dataset_version_owner_id_source_unique;
ALTER TABLE dna.import_batch
  DROP CONSTRAINT IF EXISTS import_batch_owner_id_source_unique;

COMMIT;

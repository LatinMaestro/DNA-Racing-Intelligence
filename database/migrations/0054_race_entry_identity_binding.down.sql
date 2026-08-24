BEGIN;

REVOKE ALL ON FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;

DROP FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
);

ALTER FUNCTION dna.accept_staged_race_dataset_pre_identity(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) RENAME TO accept_staged_race_dataset;

ALTER TABLE dna.race_entry
  DROP COLUMN source_fingerprint_sha256;

COMMIT;

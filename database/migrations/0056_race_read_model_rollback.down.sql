BEGIN;

REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text, text, timestamptz
) FROM PUBLIC;

DROP FUNCTION dna.rollback_active_dataset(text, text, timestamptz);

ALTER FUNCTION dna.rollback_active_dataset_pre_read_model(
  text, text, timestamptz
) RENAME TO rollback_active_dataset;

COMMIT;

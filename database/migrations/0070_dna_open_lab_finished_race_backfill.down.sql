BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_finished_race_window_receipt(
  uuid, text
);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_finished_race_backfill_checkpoint(
  uuid
);
DROP FUNCTION IF EXISTS dna.save_dna_open_lab_finished_race_backfill_checkpoint(
  uuid, bigint, jsonb, jsonb
);
DROP FUNCTION IF EXISTS dna.validate_dna_open_lab_finished_race_backfill_checkpoint(
  jsonb
);
DROP TABLE IF EXISTS dna.dna_open_lab_finished_race_window_receipt;
DROP TABLE IF EXISTS dna.dna_open_lab_finished_race_backfill_checkpoint;

COMMIT;

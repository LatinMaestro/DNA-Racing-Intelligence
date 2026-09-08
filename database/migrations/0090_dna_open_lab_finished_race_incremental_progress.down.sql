BEGIN;

DROP FUNCTION IF EXISTS dna.save_dna_open_lab_finished_race_incremental_progress(
  uuid, bigint, jsonb, jsonb
);
DROP TABLE IF EXISTS dna.dna_open_lab_finished_race_incremental_window_receipt;

COMMIT;

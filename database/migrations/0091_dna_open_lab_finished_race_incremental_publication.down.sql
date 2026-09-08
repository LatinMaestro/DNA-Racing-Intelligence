BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_finished_race_incremental_last_good(uuid);
DROP FUNCTION IF EXISTS dna.publish_dna_open_lab_finished_race_incremental_cycle(
  uuid, text, integer, integer, bigint, bigint, character, timestamptz, timestamptz
);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_finished_race_incremental_receipts(
  uuid, text, integer
);
DROP TABLE IF EXISTS dna.dna_open_lab_finished_race_incremental_active;
DROP TABLE IF EXISTS dna.dna_open_lab_finished_race_incremental_publication;

COMMIT;

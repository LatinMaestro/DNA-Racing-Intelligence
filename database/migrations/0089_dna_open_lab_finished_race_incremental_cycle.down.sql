BEGIN;

DROP FUNCTION IF EXISTS dna.read_latest_complete_dna_finished_race_incremental_cycle(uuid);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer);
DROP FUNCTION IF EXISTS dna.save_dna_open_lab_finished_race_incremental_cycle(uuid,bigint,jsonb);
DROP FUNCTION IF EXISTS dna.validate_dna_open_lab_finished_race_incremental_cycle(jsonb);
DROP TABLE IF EXISTS dna.dna_open_lab_finished_race_incremental_attempt;
DROP TABLE IF EXISTS dna.dna_open_lab_finished_race_incremental_cycle;

COMMIT;

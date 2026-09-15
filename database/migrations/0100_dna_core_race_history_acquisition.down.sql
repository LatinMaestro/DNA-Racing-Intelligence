BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_core_race_history_checkpoints(uuid,text,integer);
DROP FUNCTION IF EXISTS dna.read_next_dna_core_race_history_checkpoint(uuid,text,integer);
DROP FUNCTION IF EXISTS dna.read_latest_complete_dna_core_race_history_acquisition(uuid);
DROP FUNCTION IF EXISTS dna.read_dna_core_race_history_acquisition_attempt(uuid,text,integer);
DROP FUNCTION IF EXISTS dna.save_dna_core_race_history_page_progress(uuid,bigint,jsonb,jsonb);
DROP FUNCTION IF EXISTS dna.save_dna_core_race_history_acquisition_attempt(uuid,bigint,jsonb);
DROP FUNCTION IF EXISTS dna.validate_dna_core_race_history_page_receipt(jsonb);
DROP FUNCTION IF EXISTS dna.validate_dna_core_race_history_checkpoint(jsonb);
DROP FUNCTION IF EXISTS dna.validate_dna_core_race_history_acquisition_cycle(jsonb);
DROP TABLE IF EXISTS dna.dna_core_race_history_page_receipt;
DROP TABLE IF EXISTS dna.dna_core_race_history_core_checkpoint;
DROP TABLE IF EXISTS dna.dna_core_race_history_acquisition_attempt;
DROP TABLE IF EXISTS dna.dna_core_race_history_acquisition_cycle;

COMMIT;

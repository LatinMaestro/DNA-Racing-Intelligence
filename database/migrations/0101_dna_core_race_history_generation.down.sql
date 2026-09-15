BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_core_race_history_generation(uuid,text);
DROP FUNCTION IF EXISTS dna.publish_dna_core_race_history_generation(uuid,text,text,integer,text,timestamptz);
DROP FUNCTION IF EXISTS dna.stage_dna_core_race_history_generation_rows(uuid,text,text,integer,jsonb);
DROP FUNCTION IF EXISTS dna.begin_dna_core_race_history_generation(uuid,text,jsonb);
DROP TABLE IF EXISTS dna.dna_core_race_history_generation_active;
DROP TABLE IF EXISTS dna.dna_core_race_history_generation_row;
DROP TABLE IF EXISTS dna.dna_core_race_history_generation;

COMMIT;

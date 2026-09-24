BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_population_race_index_generation(uuid,text);
DROP FUNCTION IF EXISTS dna.publish_dna_population_race_index_generation(uuid,text,text,timestamp with time zone);
DROP FUNCTION IF EXISTS dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone);
DROP FUNCTION IF EXISTS dna.begin_dna_population_race_index_generation(uuid,text,jsonb,timestamp with time zone);

DROP TABLE IF EXISTS dna.dna_population_race_index_active;
DROP TABLE IF EXISTS dna.dna_population_race_index_entrant;
DROP TABLE IF EXISTS dna.dna_population_race_index_race;
DROP TABLE IF EXISTS dna.dna_population_race_index_batch_receipt;
DROP TABLE IF EXISTS dna.dna_population_race_index_generation;

COMMIT;

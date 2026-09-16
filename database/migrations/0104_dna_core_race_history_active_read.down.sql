BEGIN;

REVOKE ALL ON FUNCTION dna.read_active_dna_core_race_history_generation_rows(uuid,integer,integer) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_active_dna_core_race_history_generation(uuid) FROM dna_app_runtime;
DROP FUNCTION dna.read_active_dna_core_race_history_generation_rows(uuid,integer,integer);
DROP FUNCTION dna.read_active_dna_core_race_history_generation(uuid);

COMMIT;

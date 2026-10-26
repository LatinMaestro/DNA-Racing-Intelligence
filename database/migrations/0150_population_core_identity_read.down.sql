BEGIN;
DROP FUNCTION dna.read_dna_population_core_identity(uuid,bigint);
DROP INDEX dna.dna_population_core_history_authority_latest_idx;
COMMIT;

BEGIN;
DROP FUNCTION IF EXISTS dna.read_vault_performance_summary_snapshot(uuid, text);
DROP TABLE IF EXISTS dna.vault_performance_summary_snapshot;
COMMIT;

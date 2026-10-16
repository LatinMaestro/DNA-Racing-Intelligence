BEGIN;
DROP FUNCTION IF EXISTS dna.read_lifecycle_ranking_evidence_snapshot(uuid);
DROP TABLE IF EXISTS dna.lifecycle_ranking_evidence_snapshot;
COMMIT;

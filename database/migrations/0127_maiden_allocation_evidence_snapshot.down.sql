BEGIN;
DROP FUNCTION IF EXISTS dna.read_maiden_allocation_evidence_snapshot(uuid);
DROP TABLE IF EXISTS dna.maiden_allocation_evidence_snapshot;
COMMIT;

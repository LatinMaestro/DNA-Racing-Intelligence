BEGIN;
DROP FUNCTION IF EXISTS dna.read_private_readiness_assessment_snapshot(uuid);
DROP TABLE IF EXISTS dna.private_readiness_assessment_snapshot;
COMMIT;

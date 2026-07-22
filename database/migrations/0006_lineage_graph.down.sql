BEGIN;

DROP FUNCTION IF EXISTS dna.evaluate_family_pair(uuid, uuid);
DROP FUNCTION IF EXISTS dna.refresh_core_lineage(timestamptz);
DROP TABLE IF EXISTS dna.core_lineage_validation_issue;
DROP TABLE IF EXISTS dna.core_lineage_reachability;

COMMIT;

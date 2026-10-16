BEGIN;
DROP FUNCTION IF EXISTS dna.publish_maiden_allocation_evidence_snapshot(uuid,text,timestamptz,text,text);
DROP FUNCTION IF EXISTS dna.read_maiden_allocation_accepted_source_identity(uuid);
DROP FUNCTION IF EXISTS dna.read_maiden_allocation_accepted_generation(uuid);
DROP TABLE IF EXISTS dna.maiden_allocation_accepted_generation;
COMMIT;

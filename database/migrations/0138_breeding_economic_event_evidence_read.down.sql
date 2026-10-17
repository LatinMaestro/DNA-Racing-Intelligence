BEGIN;
DROP FUNCTION IF EXISTS dna.list_breeding_economic_evidence_by_event(uuid,text,integer);
DROP INDEX IF EXISTS dna.breeding_economic_event_evidence_idx;
COMMIT;

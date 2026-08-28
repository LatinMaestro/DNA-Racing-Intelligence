BEGIN;

REVOKE EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_current_state_evidence_index(uuid) FROM dna_app_runtime;
REVOKE EXECUTE ON FUNCTION dna.publish_dna_open_lab_indexed_sync_candidate(uuid,uuid,timestamptz) FROM dna_app_runtime;
REVOKE EXECUTE ON FUNCTION dna.save_dna_open_lab_current_state_evidence_index(uuid,uuid,jsonb,timestamptz) FROM dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamptz) TO dna_app_runtime;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_serving_current_state_evidence_index(uuid);
DROP FUNCTION IF EXISTS dna.publish_dna_open_lab_indexed_sync_candidate(uuid,uuid,timestamptz);
DROP FUNCTION IF EXISTS dna.save_dna_open_lab_current_state_evidence_index(uuid,uuid,jsonb,timestamptz);
DROP FUNCTION IF EXISTS dna.validate_dna_open_lab_current_state_evidence_index(uuid,jsonb);
DROP TABLE IF EXISTS dna.dna_open_lab_current_state_evidence_index;

COMMIT;

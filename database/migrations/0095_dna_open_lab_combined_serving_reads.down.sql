BEGIN;

REVOKE EXECUTE ON FUNCTION
  dna.read_dna_open_lab_combined_serving_sync_state(uuid),
  dna.read_dna_open_lab_combined_serving_active_races(uuid),
  dna.read_dna_open_lab_combined_serving_race_fills(uuid),
  dna.read_dna_open_lab_combined_serving_supplemental_cores(uuid),
  dna.read_dna_open_lab_combined_serving_current_state_evidence_index(uuid)
FROM dna_app_runtime;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_combined_serving_current_state_evidence_index(uuid);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_combined_serving_supplemental_cores(uuid);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_combined_serving_race_fills(uuid);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_combined_serving_active_races(uuid);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_combined_serving_sync_state(uuid);

COMMIT;

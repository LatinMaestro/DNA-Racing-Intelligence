BEGIN;

REVOKE ALL ON FUNCTION
  dna.read_dna_open_lab_combined_serving_finished_history(uuid)
FROM dna_app_runtime;

DROP FUNCTION IF EXISTS
  dna.read_dna_open_lab_combined_serving_finished_history(uuid);

COMMIT;

BEGIN;

REVOKE EXECUTE ON FUNCTION
  dna.read_dna_open_lab_combined_serving_owned_cores(uuid)
FROM dna_app_runtime;

DROP FUNCTION IF EXISTS
  dna.read_dna_open_lab_combined_serving_owned_cores(uuid);

COMMIT;

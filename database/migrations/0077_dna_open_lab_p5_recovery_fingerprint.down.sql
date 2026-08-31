BEGIN;

REVOKE EXECUTE ON FUNCTION dna.read_dna_open_lab_p5_recovery_fingerprints(uuid)
FROM dna_app_runtime;
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_p5_recovery_fingerprints(uuid);

COMMIT;

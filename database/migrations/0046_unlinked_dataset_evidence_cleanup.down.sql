BEGIN;

REVOKE ALL ON FUNCTION dna.cleanup_unlinked_dataset_evidence_batch(
  uuid, uuid, character
) FROM dna_app_runtime;
DROP FUNCTION IF EXISTS dna.cleanup_unlinked_dataset_evidence_batch(
  uuid, uuid, character
);

COMMIT;

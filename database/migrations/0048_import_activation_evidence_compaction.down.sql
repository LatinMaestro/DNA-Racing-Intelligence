BEGIN;

REVOKE ALL ON FUNCTION dna.compact_import_activation_dataset_evidence(
  uuid, uuid, uuid, timestamptz, integer
) FROM dna_app_runtime;
DROP FUNCTION IF EXISTS dna.compact_import_activation_dataset_evidence(
  uuid, uuid, uuid, timestamptz, integer
);

COMMIT;

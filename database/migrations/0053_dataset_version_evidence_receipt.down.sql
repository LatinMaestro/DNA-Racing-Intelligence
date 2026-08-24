BEGIN;

REVOKE ALL ON FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON TABLE dna.dataset_version_evidence_receipt FROM dna_app_runtime;

DROP FUNCTION IF EXISTS dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
);
DROP TABLE IF EXISTS dna.dataset_version_evidence_receipt;

COMMIT;

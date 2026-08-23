BEGIN;

REVOKE ALL ON FUNCTION dna.compact_accepted_dataset_evidence(
  uuid, uuid, timestamptz
) FROM dna_app_runtime;
DROP FUNCTION IF EXISTS dna.compact_accepted_dataset_evidence(
  uuid, uuid, timestamptz
);
DROP TABLE IF EXISTS dna.dataset_evidence_compaction_receipt;

COMMIT;

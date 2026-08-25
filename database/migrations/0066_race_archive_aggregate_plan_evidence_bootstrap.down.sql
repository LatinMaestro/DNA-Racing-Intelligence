BEGIN;

REVOKE ALL ON FUNCTION dna.bootstrap_race_archive_aggregate_evidence_receipts(
  uuid, uuid, uuid, character
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.bootstrap_race_archive_aggregate_evidence_receipts(
  uuid, uuid, uuid, character
) FROM PUBLIC;
DROP FUNCTION dna.bootstrap_race_archive_aggregate_evidence_receipts(
  uuid, uuid, uuid, character
);

COMMIT;

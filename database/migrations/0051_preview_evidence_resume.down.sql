BEGIN;

DROP FUNCTION IF EXISTS dna.finalize_import_preview_evidence_receipts(
  uuid, uuid[], timestamptz
);
DROP FUNCTION IF EXISTS dna.record_import_preview_evidence_receipts(
  uuid, uuid, jsonb
);
DROP TABLE IF EXISTS dna.import_preview_evidence_receipt;

COMMIT;

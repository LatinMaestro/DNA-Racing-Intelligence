BEGIN;

REVOKE EXECUTE ON FUNCTION dna.mark_import_upload_reservation_failed(
  uuid, uuid, character, timestamptz
) FROM dna_app_runtime;
REVOKE EXECUTE ON FUNCTION dna.mark_import_upload_targets_ready(
  uuid, uuid, uuid[], character, timestamptz
) FROM dna_app_runtime;
REVOKE EXECUTE ON FUNCTION dna.reserve_import_upload_batch(
  uuid, text, character, timestamptz, jsonb
) FROM dna_app_runtime;
REVOKE SELECT ON TABLE dna.import_upload_file FROM dna_app_runtime;
REVOKE SELECT ON TABLE dna.import_upload_batch FROM dna_app_runtime;

DROP FUNCTION dna.mark_import_upload_reservation_failed(
  uuid, uuid, character, timestamptz
);
DROP FUNCTION dna.mark_import_upload_targets_ready(
  uuid, uuid, uuid[], character, timestamptz
);
DROP FUNCTION dna.reserve_import_upload_batch(
  uuid, text, character, timestamptz, jsonb
);
DROP TABLE dna.import_upload_file;
DROP TABLE dna.import_upload_batch;

COMMIT;

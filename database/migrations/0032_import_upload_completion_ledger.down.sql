BEGIN;

DROP FUNCTION IF EXISTS dna.record_import_upload_verification_failure(
  uuid, uuid, uuid, timestamptz, text
);
DROP FUNCTION IF EXISTS dna.mark_import_preview_dispatch_failed(
  uuid, uuid, uuid, timestamptz
);
DROP FUNCTION IF EXISTS dna.mark_import_preview_dispatch_queued(
  uuid, uuid, uuid, timestamptz
);
DROP FUNCTION IF EXISTS dna.reserve_import_preview_dispatch(
  uuid, uuid, uuid, character, timestamptz, jsonb
);
DROP FUNCTION IF EXISTS dna.claim_import_upload_completion(
  uuid, uuid, text, character, timestamptz
);

DROP TABLE IF EXISTS dna.import_verified_upload_object;
DROP TABLE IF EXISTS dna.import_preview_dispatch;
DROP TABLE IF EXISTS dna.import_upload_completion;

COMMIT;

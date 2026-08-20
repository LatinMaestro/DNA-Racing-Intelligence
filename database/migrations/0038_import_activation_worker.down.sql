BEGIN;

DROP FUNCTION IF EXISTS dna.record_import_activation_failure(
  uuid, uuid, uuid, text, timestamptz
);
DROP FUNCTION IF EXISTS dna.complete_import_activation(
  uuid, uuid, uuid, text, timestamptz, integer, bigint, boolean
);
DROP FUNCTION IF EXISTS dna.claim_import_activation_dispatch(
  uuid, uuid, text, timestamptz, timestamptz
);
DROP FUNCTION IF EXISTS dna.mark_import_activation_dispatch_failed(
  uuid, uuid, uuid, timestamptz
);
DROP FUNCTION IF EXISTS dna.mark_import_activation_dispatch_queued(
  uuid, uuid, uuid, timestamptz
);
DROP FUNCTION IF EXISTS dna.reserve_import_activation(
  uuid, text, character, text, timestamptz
);
DROP TABLE IF EXISTS dna.import_activation_processing;
DROP TABLE IF EXISTS dna.import_activation_dispatch;

COMMIT;

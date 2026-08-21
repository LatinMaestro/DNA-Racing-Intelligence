BEGIN;

REVOKE ALL ON FUNCTION dna.cleanup_import_before_activation(
  uuid, uuid, character, text, timestamptz
) FROM dna_app_runtime;

DROP FUNCTION IF EXISTS dna.cleanup_import_before_activation(
  uuid, uuid, character, text, timestamptz
);
DROP TABLE IF EXISTS dna.import_pre_activation_cleanup;

COMMIT;

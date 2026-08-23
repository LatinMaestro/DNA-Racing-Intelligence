BEGIN;

REVOKE ALL ON FUNCTION dna.cleanup_confirmed_import_before_dispatch(
  uuid, uuid, character, text, character, uuid, uuid, text, timestamptz
) FROM dna_app_runtime;

DROP FUNCTION IF EXISTS dna.cleanup_confirmed_import_before_dispatch(
  uuid, uuid, character, text, character, uuid, uuid, text, timestamptz
);
DROP TABLE IF EXISTS dna.import_confirmation_cleanup;

COMMIT;

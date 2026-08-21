BEGIN;

DROP FUNCTION IF EXISTS dna.assert_import_activation_ready(
  uuid, text, character
);

DROP FUNCTION IF EXISTS dna.prepare_import_activation_dataset(
  uuid, uuid, uuid, character, integer
);

COMMIT;

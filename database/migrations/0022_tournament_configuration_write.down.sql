BEGIN;

DROP FUNCTION IF EXISTS dna.upsert_tournament_configuration(
  uuid, text, text, text, text, text, integer[], text, text, text, text, timestamptz
);

COMMIT;

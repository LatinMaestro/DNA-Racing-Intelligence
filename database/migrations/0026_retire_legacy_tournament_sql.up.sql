BEGIN;

REVOKE ALL ON FUNCTION dna.list_tournament_configurations(uuid)
FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.upsert_tournament_configuration(
  uuid, text, text, text, text, text, integer[], text, text, text, text,
  timestamptz
) FROM dna_app_runtime;

DROP FUNCTION dna.list_tournament_configurations(uuid);
DROP FUNCTION dna.upsert_tournament_configuration(
  uuid, text, text, text, text, text, integer[], text, text, text, text,
  timestamptz
);

COMMIT;

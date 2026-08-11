BEGIN;

REVOKE ALL ON FUNCTION
  dna.list_complete_tournament_configurations(uuid)
FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.upsert_complete_tournament_configuration(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text,
  integer[], integer, numeric, text, text, text[], text[], text[],
  integer[], jsonb, jsonb, text, jsonb, integer, integer, numeric,
  text, integer, jsonb, jsonb, text, text, text, text, text, jsonb,
  jsonb
) FROM dna_app_runtime;

DROP FUNCTION dna.list_complete_tournament_configurations(uuid);
DROP FUNCTION dna.upsert_complete_tournament_configuration(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text,
  integer[], integer, numeric, text, text, text[], text[], text[],
  integer[], jsonb, jsonb, text, jsonb, integer, integer, numeric,
  text, integer, jsonb, jsonb, text, text, text, text, text, jsonb,
  jsonb
);

ALTER TABLE dna.tournament_configuration
  DROP CONSTRAINT tournament_campaign_action_valid,
  DROP COLUMN campaign_action;

COMMIT;

BEGIN;

DROP FUNCTION IF EXISTS dna.pro_league_aggregate_refresh_target_source_type(
  uuid, uuid, uuid, character
);

COMMIT;
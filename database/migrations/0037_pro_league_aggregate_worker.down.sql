BEGIN;

DROP FUNCTION IF EXISTS dna.record_pro_league_aggregate_refresh_failure(
  uuid, uuid, uuid, text, timestamptz, text
);
DROP FUNCTION IF EXISTS dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
);
DROP FUNCTION IF EXISTS dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
);
DROP FUNCTION IF EXISTS dna.claim_pro_league_aggregate_refresh(
  uuid, uuid, text, timestamptz, timestamptz
);
DROP FUNCTION IF EXISTS dna.active_pro_league_source_version_set_sha256(uuid);
DROP TABLE IF EXISTS dna.aggregate_refresh_processing;

COMMIT;

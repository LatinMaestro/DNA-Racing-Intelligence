BEGIN;

DROP FUNCTION IF EXISTS dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
);

ALTER FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_archive_reuse(
  uuid, uuid, uuid, character
) RENAME TO prepare_pro_league_aggregate_refresh;

REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMIT;
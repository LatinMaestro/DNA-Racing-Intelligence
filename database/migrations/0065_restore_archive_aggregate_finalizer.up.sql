BEGIN;

DROP FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
);

ALTER FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(
  uuid, uuid, uuid, character
) RENAME TO prepare_pro_league_aggregate_refresh;

REVOKE ALL ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) IS
  'Uses the migration-0062 archive publication finalizer for Race targets and the archive-preserving current-source path for Core Details and Current Arena. Historical Race segment jobs are not dispatched individually once activation collapses aggregate work to the active source family.';

COMMIT;

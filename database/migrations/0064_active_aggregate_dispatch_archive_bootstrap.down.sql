BEGIN;

DROP FUNCTION IF EXISTS dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
);
ALTER FUNCTION dna.list_import_activation_aggregate_refreshes_pre_archive_bootstrap(
  uuid, uuid, uuid, integer
) RENAME TO list_import_activation_aggregate_refreshes;
GRANT EXECUTE ON FUNCTION dna.list_import_activation_aggregate_refreshes(
  uuid, uuid, uuid, integer
) TO dna_app_runtime;

DROP FUNCTION IF EXISTS dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
);
ALTER FUNCTION dna.begin_race_archive_aggregate_publication_pre_bootstrap(
  uuid, uuid, uuid, text, character, timestamptz
) RENAME TO begin_race_archive_aggregate_publication;
GRANT EXECUTE ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) TO dna_app_runtime;

DROP FUNCTION IF EXISTS dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
);
ALTER FUNCTION dna.list_race_archive_aggregate_refresh_versions_pre_bootstrap(
  uuid, uuid, uuid, character, integer
) RENAME TO list_race_archive_aggregate_refresh_versions;
GRANT EXECUTE ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) TO dna_app_runtime;

DROP FUNCTION IF EXISTS dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
);
ALTER FUNCTION dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(
  uuid, uuid, uuid, character
) RENAME TO prepare_pro_league_aggregate_refresh;
GRANT EXECUTE ON FUNCTION dna.prepare_pro_league_aggregate_refresh(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMIT;

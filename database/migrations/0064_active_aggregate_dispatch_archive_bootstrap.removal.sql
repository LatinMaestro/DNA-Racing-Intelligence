DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.list_import_activation_aggregate_refreshes_pre_archive_bootstra(uuid,uuid,uuid,integer)'
  ) IS NOT NULL
     OR to_regprocedure(
       'dna.begin_race_archive_aggregate_publication_pre_bootstrap(uuid,uuid,uuid,text,character,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.list_race_archive_aggregate_refresh_versions_pre_archive_bootst(uuid,uuid,uuid,character,integer)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(uuid,uuid,uuid,character)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'archive bootstrap predecessor functions remain after rollback';
  END IF;

  IF to_regprocedure(
    'dna.list_import_activation_aggregate_refreshes(uuid,uuid,uuid,integer)'
  ) IS NULL
     OR to_regprocedure(
       'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)'
     ) IS NULL
     OR to_regprocedure(
       'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)'
     ) IS NULL
     OR to_regprocedure(
       'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)'
     ) IS NULL THEN
    RAISE EXCEPTION 'archive bootstrap rollback did not restore predecessor functions';
  END IF;
END
$removal$;

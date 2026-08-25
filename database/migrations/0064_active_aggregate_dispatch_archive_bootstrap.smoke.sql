DO $smoke$
DECLARE
  v_prepare_definition text;
BEGIN
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
    RAISE EXCEPTION 'archive bootstrap public runtime functions are incomplete';
  END IF;

  IF to_regprocedure(
    'dna.list_import_activation_aggregate_refreshes_pre_archive_bootstra(uuid,uuid,uuid,integer)'
  ) IS NULL
     OR to_regprocedure(
       'dna.begin_race_archive_aggregate_publication_pre_bootstrap(uuid,uuid,uuid,text,character,timestamp with time zone)'
     ) IS NULL
     OR to_regprocedure(
       'dna.list_race_archive_aggregate_refresh_versions_pre_archive_bootst(uuid,uuid,uuid,character,integer)'
     ) IS NULL
     OR to_regprocedure(
       'dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(uuid,uuid,uuid,character)'
     ) IS NULL THEN
    RAISE EXCEPTION 'archive bootstrap rollback predecessors are incomplete';
  END IF;

  IF NOT has_function_privilege(
       'dna_app_runtime',
       'dna.list_import_activation_aggregate_refreshes(uuid,uuid,uuid,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'archive bootstrap runtime execution grants are incomplete';
  END IF;

  IF has_function_privilege(
       'dna_app_runtime',
       'dna.list_import_activation_aggregate_refreshes_pre_archive_bootstra(uuid,uuid,uuid,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'dna_app_runtime',
       'dna.begin_race_archive_aggregate_publication_pre_bootstrap(uuid,uuid,uuid,text,character,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'dna_app_runtime',
       'dna.list_race_archive_aggregate_refresh_versions_pre_archive_bootst(uuid,uuid,uuid,character,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'dna_app_runtime',
       'dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(uuid,uuid,uuid,character)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'archive bootstrap predecessor execution leaked to runtime';
  END IF;

  SELECT pg_get_functiondef(
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)'::regprocedure
  ) INTO v_prepare_definition;

  IF position('UPDATE dna.dataset_version version' IN v_prepare_definition) = 0
     OR position('UPDATE dna.aggregate_refresh_job job' IN v_prepare_definition) = 0
     OR position('version.version_number <= v_target_version_number' IN v_prepare_definition) = 0
     OR position('race_archive_aggregate_publication_receipt' IN v_prepare_definition) = 0 THEN
    RAISE EXCEPTION 'archive bootstrap finalizer no longer closes historical Race segment refresh state from the immutable archive publication receipt';
  END IF;
END
$smoke$;

DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Race archive aggregate refresh plan function remains after rollback';
  END IF;
  IF to_regprocedure(
    'dna.prepare_pro_league_aggregate_refresh_pre_race_archive_switch(uuid,uuid,uuid,character)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Race archive aggregate refresh backup function remains after rollback';
  END IF;
  IF to_regprocedure(
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)'
  ) IS NULL THEN
    RAISE EXCEPTION 'pre-0062 aggregate preparation function was not restored';
  END IF;
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime aggregate preparation privilege was not restored';
  END IF;
END
$removal$;

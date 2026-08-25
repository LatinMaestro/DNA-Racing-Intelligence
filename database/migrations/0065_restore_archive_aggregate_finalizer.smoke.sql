DO $smoke$
BEGIN
  IF to_regprocedure(
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)'
  ) IS NULL THEN
    RAISE EXCEPTION 'archive aggregate finalizer is unavailable';
  END IF;
  IF to_regprocedure(
    'dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(uuid,uuid,uuid,character)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'obsolete aggregate finalizer wrapper remains active';
  END IF;
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute restored aggregate finalizer';
  END IF;
END
$smoke$;

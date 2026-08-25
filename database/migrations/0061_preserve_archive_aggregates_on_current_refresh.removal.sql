DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.prepare_pro_league_aggregate_refresh_pre_archive_reuse(uuid,uuid,uuid,character)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'archive-reuse aggregate preparation function remains after reversal';
  END IF;
  IF to_regprocedure(
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)'
  ) IS NULL THEN
    RAISE EXCEPTION 'original aggregate preparation function was not restored';
  END IF;
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'original aggregate preparation runtime privilege was not restored';
  END IF;
END
$removal$;
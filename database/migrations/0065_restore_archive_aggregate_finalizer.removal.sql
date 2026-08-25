DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.prepare_pro_league_aggregate_refresh(uuid,uuid,uuid,character)'
  ) IS NULL
     OR to_regprocedure(
       'dna.prepare_pro_league_aggregate_refresh_pre_archive_collapse(uuid,uuid,uuid,character)'
     ) IS NULL THEN
    RAISE EXCEPTION 'aggregate finalizer rollback did not restore migration-0064 state';
  END IF;
END
$removal$;

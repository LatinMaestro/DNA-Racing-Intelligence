DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.pro_league_aggregate_refresh_target_source_type(uuid,uuid,uuid,character)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'aggregate refresh target source function remains after rollback';
  END IF;
END
$removal$;
DO $multi_source_aggregate_removal$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.refresh_pro_league_aggregates(uuid,timestamp with time zone)'::regprocedure
  )
  INTO STRICT v_definition;

  IF position('v_active_race_version_id' in v_definition) > 0
     OR position(
       'refresh_star_profiles(p_dataset_version_id, p_refreshed_at)'
       in v_definition
     ) = 0 THEN
    RAISE EXCEPTION 'multi-source aggregate refresh override was not removed';
  END IF;
END
$multi_source_aggregate_removal$;

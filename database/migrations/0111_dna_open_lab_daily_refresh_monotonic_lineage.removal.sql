DO $daily_refresh_monotonic_lineage_removal$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.publish_dna_open_lab_daily_refresh_generation(uuid,text,text,text,text,uuid,bigint,bigint,bigint,timestamp with time zone)'::regprocedure
  ) INTO v_definition;

  IF position('WITH RECURSIVE lineage AS' in v_definition) > 0 THEN
    RAISE EXCEPTION 'multi-hop daily refresh lineage guard remains after reversal';
  END IF;

  IF position(
    'v_finished.previous_published_cycle_id <> v_previous.finished_history_cycle_id' in v_definition
  ) = 0 THEN
    RAISE EXCEPTION 'legacy direct-predecessor daily refresh guard was not restored';
  END IF;
END
$daily_refresh_monotonic_lineage_removal$;

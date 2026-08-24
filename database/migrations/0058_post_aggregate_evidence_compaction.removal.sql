DO $post_aggregate_evidence_compaction_removal$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.publish_pro_league_aggregate_refresh(uuid,uuid,uuid,text,uuid,character,integer,bigint,timestamp with time zone)'::regprocedure
  ) INTO STRICT v_definition;

  IF position('seal_dataset_version_evidence' IN v_definition) > 0
     OR position('compact_race_row_evidence' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'post-aggregate evidence compaction behavior was not removed';
  END IF;
END
$post_aggregate_evidence_compaction_removal$;

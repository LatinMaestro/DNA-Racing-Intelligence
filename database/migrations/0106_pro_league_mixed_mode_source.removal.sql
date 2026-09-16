DO $removal$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.begin_pro_league_evidence_generation_from_core_history(uuid,uuid,character,text,character,timestamp with time zone,bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%p_non_bike_entry_count <> 0%'
     OR v_definition LIKE '%JOIN LATERAL%' THEN
    RAISE EXCEPTION 'mixed-mode Pro League source reversal is incomplete';
  END IF;
END
$removal$;

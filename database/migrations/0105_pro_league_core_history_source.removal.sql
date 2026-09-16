DO $removal$
BEGIN
  IF to_regprocedure('dna.begin_pro_league_evidence_generation_from_core_history(uuid,uuid,character,text,character,timestamp with time zone,bigint,bigint,bigint,bigint,bigint,bigint)') IS NOT NULL
     OR to_regprocedure('dna.publish_pro_league_evidence_generation_from_core_history(uuid,uuid,text,integer,integer,bigint,character,timestamp with time zone)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'dna'
         AND table_name = 'pro_league_evidence_generation'
         AND column_name IN ('source_kind', 'core_history_generation_id')
     ) THEN
    RAISE EXCEPTION 'Pro League Core history evidence source removal is incomplete';
  END IF;
END
$removal$;

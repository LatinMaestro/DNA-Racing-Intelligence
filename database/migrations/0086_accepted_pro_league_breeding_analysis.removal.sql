DO $removal$
BEGIN
  IF to_regclass('dna.accepted_pro_league_breeding_analysis') IS NOT NULL
     OR to_regprocedure('dna.record_accepted_pro_league_breeding_analysis(uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,character,text)') IS NOT NULL
     OR to_regprocedure('dna.read_accepted_pro_league_breeding_analysis(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'accepted Pro League breeding analysis removal is incomplete';
  END IF;
END
$removal$;

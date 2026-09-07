DO $removal$
BEGIN
  IF to_regclass('dna.pro_league_breeding_ranking_generation') IS NOT NULL
     OR to_regclass('dna.pro_league_breeding_ranking_row') IS NOT NULL
     OR to_regclass('dna.pro_league_breeding_ranking_active') IS NOT NULL
     OR to_regprocedure('dna.publish_pro_league_breeding_ranking_generation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,character,jsonb,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.read_active_pro_league_breeding_ranking_generation(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Pro League breeding ranking generation removal is incomplete';
  END IF;
END
$removal$;

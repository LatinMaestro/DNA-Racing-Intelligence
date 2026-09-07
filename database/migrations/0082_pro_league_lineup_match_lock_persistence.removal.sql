DO $removal$
BEGIN
  IF to_regclass('dna.pro_league_lineup_version') IS NOT NULL
     OR to_regclass('dna.pro_league_lineup_entry_snapshot') IS NOT NULL
     OR to_regclass('dna.pro_league_match_lock') IS NOT NULL
     OR to_regprocedure('dna.store_pro_league_lineup_version(uuid,text,integer,text,text,text,text,text,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.read_pro_league_lineup_version(uuid,text)') IS NOT NULL
     OR to_regprocedure('dna.store_pro_league_match_lock(uuid,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)') IS NOT NULL
     OR to_regprocedure('dna.read_pro_league_match_lock(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Pro League lineup/match-lock persistence removal is incomplete';
  END IF;
END
$removal$;

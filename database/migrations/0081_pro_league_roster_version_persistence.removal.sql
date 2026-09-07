DO $removal$
BEGIN
  IF to_regclass('dna.pro_league_roster_version') IS NOT NULL
     OR to_regclass('dna.pro_league_roster_member_snapshot') IS NOT NULL
     OR to_regclass('dna.pro_league_roster_substitution') IS NOT NULL
     OR to_regprocedure('dna.store_pro_league_roster_version(uuid,text,integer,text,text,text,timestamp with time zone,text,text,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.read_pro_league_roster_version(uuid,text)') IS NOT NULL
     OR to_regprocedure('dna.record_pro_league_roster_substitution(uuid,integer,integer,text,text,text,text,text,timestamp with time zone,text,text,text,text)') IS NOT NULL
     OR to_regprocedure('dna.list_pro_league_roster_substitutions(uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Pro League roster persistence removal is incomplete';
  END IF;
END
$removal$;

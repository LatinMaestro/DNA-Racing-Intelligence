DO $removal$
BEGIN
  IF to_regclass('dna.pro_league_evidence_generation') IS NOT NULL
     OR to_regclass('dna.pro_league_evidence_stage_row') IS NOT NULL
     OR to_regclass('dna.pro_league_evidence_row') IS NOT NULL
     OR to_regclass('dna.pro_league_evidence_active') IS NOT NULL
     OR to_regprocedure('dna.begin_pro_league_evidence_generation(uuid,uuid,uuid,text,character,timestamp with time zone,bigint,bigint,bigint,bigint,bigint,bigint)') IS NOT NULL
     OR to_regprocedure('dna.stage_pro_league_evidence_rows(uuid,uuid,text,text,integer,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.publish_pro_league_evidence_generation(uuid,uuid,text,integer,integer,bigint,character,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.read_active_pro_league_evidence_generation(uuid)') IS NOT NULL
     OR to_regprocedure('dna.list_active_pro_league_evidence_rows(uuid,text,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Pro League evidence generation removal is incomplete';
  END IF;
END
$removal$;

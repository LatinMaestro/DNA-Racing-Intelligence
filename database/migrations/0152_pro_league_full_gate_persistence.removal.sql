DO $removal$
BEGIN
  IF to_regclass('dna.pro_league_full_gate_plan') IS NOT NULL
     OR to_regclass('dna.pro_league_full_gate_assignment_snapshot') IS NOT NULL
     OR to_regprocedure('dna.store_pro_league_full_gate_plan(uuid,text,text,text,text,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.read_pro_league_full_gate_plan(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Pro League full-gate persistence objects still exist';
  END IF;
END
$removal$;

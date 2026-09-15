DO $removal$
BEGIN
  IF to_regclass('dna.dna_core_race_history_generation') IS NOT NULL
     OR to_regclass('dna.dna_core_race_history_generation_row') IS NOT NULL
     OR to_regclass('dna.dna_core_race_history_generation_active') IS NOT NULL
     OR to_regprocedure('dna.begin_dna_core_race_history_generation(uuid,text,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.stage_dna_core_race_history_generation_rows(uuid,text,text,integer,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.publish_dna_core_race_history_generation(uuid,text,text,integer,text,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_core_race_history_generation(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Core race history generation removal is incomplete';
  END IF;
END
$removal$;

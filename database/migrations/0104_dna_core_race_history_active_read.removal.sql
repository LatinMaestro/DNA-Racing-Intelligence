DO $removal$
BEGIN
  IF to_regprocedure('dna.read_active_dna_core_race_history_generation(uuid)') IS NOT NULL
     OR to_regprocedure('dna.read_active_dna_core_race_history_generation_rows(uuid,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Core history active-read removal is incomplete';
  END IF;
END
$removal$;

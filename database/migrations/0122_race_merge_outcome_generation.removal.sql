DO $race_merge_outcome_generation_removal$
BEGIN
  IF to_regclass('dna.race_merge_outcome_generation') IS NOT NULL
     OR to_regclass('dna.race_merge_outcome_object') IS NOT NULL
     OR to_regclass('dna.race_merge_outcome') IS NOT NULL
     OR to_regprocedure(
       'dna.begin_race_merge_outcome_object(uuid,text,text,text,bigint,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_race_merge_core_outcomes(uuid,text,bigint)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Race Merge outcome generation remains after reversal';
  END IF;
END
$race_merge_outcome_generation_removal$;

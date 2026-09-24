DO $population_race_index_generation_removal$
BEGIN
  IF to_regclass('dna.dna_population_race_index_generation') IS NOT NULL
     OR to_regclass('dna.dna_population_race_index_batch_receipt') IS NOT NULL
     OR to_regclass('dna.dna_population_race_index_race') IS NOT NULL
     OR to_regclass('dna.dna_population_race_index_entrant') IS NOT NULL
     OR to_regclass('dna.dna_population_race_index_active') IS NOT NULL
     OR to_regprocedure('dna.begin_dna_population_race_index_generation(uuid,text,jsonb,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.publish_dna_population_race_index_generation(uuid,text,text,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_population_race_index_generation(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'population race index generation objects remain after reversal';
  END IF;
END
$population_race_index_generation_removal$;

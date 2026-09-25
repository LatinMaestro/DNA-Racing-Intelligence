DO $population_entrant_authority_checkpoint_removal$
BEGIN
  IF to_regclass('dna.dna_population_entrant_authority_generation') IS NOT NULL
     OR to_regclass('dna.dna_population_entrant_authority_chunk') IS NOT NULL
     OR to_regprocedure(
       'dna.begin_dna_population_entrant_authority_generation(uuid,jsonb,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.register_dna_population_entrant_authority_chunk(uuid,text,jsonb,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_population_entrant_authority_generation(uuid,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_population_entrant_authority_chunk_manifests(uuid,text,integer,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'population entrant authority checkpoint remains after reversal';
  END IF;
END
$population_entrant_authority_checkpoint_removal$;

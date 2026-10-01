DO $population_entrant_authority_checkpoint_removal$
BEGIN
  IF to_regclass('dna.dna_population_entrant_authority_successor_generation') IS NOT NULL
     OR to_regclass('dna.dna_population_entrant_authority_successor_chunk') IS NOT NULL
     OR to_regprocedure(
       'dna.begin_dna_population_entrant_authority_successor_generation(uuid,jsonb,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.register_dna_population_entrant_authority_successor_chunk(uuid,text,jsonb,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_population_entrant_authority_successor_generation(uuid,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_population_entrant_authority_successor_chunk_manifests(uuid,text,integer,integer)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.reject_dna_population_entrant_authority_successor_chunk_mutation()'
     ) IS NOT NULL
     OR to_regclass('dna.dna_population_entrant_authority_generation') IS NULL
     OR to_regclass('dna.dna_population_entrant_authority_chunk') IS NULL
     OR to_regprocedure(
       'dna.begin_dna_population_entrant_authority_generation(uuid,jsonb,timestamp with time zone)'
     ) IS NULL THEN
    RAISE EXCEPTION 'population entrant authority successor reversal contract is invalid';
  END IF;
END
$population_entrant_authority_checkpoint_removal$;

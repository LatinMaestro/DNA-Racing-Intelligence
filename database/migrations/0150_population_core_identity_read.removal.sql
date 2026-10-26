DO $removal$
BEGIN
  IF to_regprocedure('dna.read_dna_population_core_identity(uuid,bigint)') IS NOT NULL
     OR to_regclass('dna.dna_population_core_history_authority_latest_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'population Core identity read removal failed';
  END IF;
END
$removal$;

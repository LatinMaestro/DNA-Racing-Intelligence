DO $removal$
BEGIN
  IF to_regprocedure('dna.read_discovery_benchmark_publication(uuid)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Discovery benchmark publication read removal failed';
  END IF;
END
$removal$;

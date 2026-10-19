DO $removal$
BEGIN
  IF to_regprocedure('dna.read_core_performance_publication(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Core performance publication read removal failed';
  END IF;
END
$removal$;

DO $removal$
BEGIN
  IF to_regprocedure(
       'dna.read_dna_open_lab_combined_serving_owned_cores(uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'combined owned Core read remains after reversal';
  END IF;
END
$removal$;

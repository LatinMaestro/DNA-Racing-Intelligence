DO $removal$
BEGIN
  IF to_regprocedure(
       'dna.read_dna_open_lab_combined_serving_finished_history(uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'combined finished-history read migration did not reverse cleanly';
  END IF;
END
$removal$;

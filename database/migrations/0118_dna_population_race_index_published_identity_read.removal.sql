DO $population_published_identity_read_removal$
BEGIN
  IF to_regprocedure(
       'dna.read_dna_population_race_index_published_compact_identities(uuid,text,text,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'published population compact identity read remains after reversal';
  END IF;
END
$population_published_identity_read_removal$;

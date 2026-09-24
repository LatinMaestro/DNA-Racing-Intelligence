DO $population_published_manifest_read_removal$
BEGIN
  IF to_regprocedure(
       'dna.read_dna_population_race_index_published_r2_chunk_manifests(uuid,text,integer,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'published population R2 manifest read remains after reversal';
  END IF;
END
$population_published_manifest_read_removal$;

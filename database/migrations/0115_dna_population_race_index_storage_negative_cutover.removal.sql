DO $population_storage_negative_removal$
BEGIN
  IF to_regprocedure('dna.retire_dna_population_race_index_chunk_rows()') IS NOT NULL
     OR to_regprocedure('dna.finalize_dna_population_race_index_storage_negative_cutover(uuid,text,text,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.retire_dna_population_race_index_storage_negative_legacy(uuid,text,timestamp with time zone)') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_trigger trigger
       JOIN pg_class relation ON relation.oid = trigger.tgrelid
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'dna'
         AND relation.relname = 'dna_population_race_index_r2_chunk'
         AND trigger.tgname = 'retire_population_race_index_chunk_rows'
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION 'population storage-negative cutover objects remain after reversal';
  END IF;
END
$population_storage_negative_removal$;

DO $removal$
BEGIN
  IF to_regprocedure(
       'dna.begin_dna_core_race_history_generation_v3(uuid,text,jsonb)'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute attribute
       WHERE attribute.attrelid =
         'dna.dna_core_race_history_generation'::regclass
         AND attribute.attname = 'entrant_mismatch_omission_count'
         AND NOT attribute.attisdropped
     ) THEN
    RAISE EXCEPTION 'Core history entrant mismatch migration was not removed';
  END IF;
END
$removal$;

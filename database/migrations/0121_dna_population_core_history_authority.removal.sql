DO $population_core_history_authority_removal$
BEGIN
  IF to_regclass('dna.dna_population_core_history_authority') IS NOT NULL
     OR to_regprocedure(
       'dna.begin_dna_population_core_history_acquisition_attempt(uuid,jsonb,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.reject_dna_population_core_history_authority_mutation()'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'population Core history authority remains after reversal';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint constraint_row
    WHERE constraint_row.conrelid =
        'dna.dna_core_race_history_acquisition_cycle'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'dna.dna_open_lab_sync_generation'::regclass
  ) THEN
    RAISE EXCEPTION 'Core history owned-generation foreign key was not restored';
  END IF;
END
$population_core_history_authority_removal$;

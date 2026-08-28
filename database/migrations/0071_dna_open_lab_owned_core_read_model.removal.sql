DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_owned_core_snapshot') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'dna'
         AND table_name = 'dna_open_lab_sync_generation'
         AND column_name = 'materialization_contract_version'
     )
     OR to_regprocedure(
       'dna.stage_dna_open_lab_materialized_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.enforce_dna_open_lab_materialized_publication()'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_serving_owned_cores(uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab owned Core read-model objects still exist';
  END IF;
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'legacy DNA Open Lab staging grant was not restored';
  END IF;
END
$removal$;

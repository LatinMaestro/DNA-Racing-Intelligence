DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_active_race_snapshot') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_race_fill_snapshot') IS NOT NULL
     OR to_regprocedure(
       'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_serving_active_races(uuid)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_serving_race_fills(uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab current-race read-model objects still exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM dna.dna_open_lab_sync_generation
    WHERE materialization_contract_version > 1
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_materialized_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'DNA Open Lab owned-Core materialization boundary was not restored';
  END IF;
END
$removal$;

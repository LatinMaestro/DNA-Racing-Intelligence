DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_token_prices_snapshot') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_splice_arena_mode_snapshot') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_splice_arena_page_snapshot') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_splice_arena_listing_snapshot') IS NOT NULL
     OR to_regprocedure(
       'dna.validate_dna_open_lab_token_splice_payload(timestamp with time zone,jsonb,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.stage_dna_open_lab_token_splice_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_serving_token_prices(uuid)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_serving_splice_arena_pages(uuid)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_serving_splice_arena(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab Token/Splice read-model objects still exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM dna.dna_open_lab_sync_generation
    WHERE materialization_contract_version > 3
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_supplemental_core_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'DNA Open Lab supplemental Core boundary was not restored';
  END IF;
END
$removal$;

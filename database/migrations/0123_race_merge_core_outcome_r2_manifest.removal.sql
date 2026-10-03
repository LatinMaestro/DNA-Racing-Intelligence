DO $removal$
BEGIN
  IF to_regclass('dna.race_merge_core_outcome_r2_generation') IS NOT NULL
    OR to_regclass('dna.race_merge_core_outcome_r2_manifest') IS NOT NULL
    OR to_regprocedure('dna.begin_race_merge_core_outcome_r2_generation(uuid,jsonb,timestamp with time zone)') IS NOT NULL
    OR to_regprocedure('dna.register_race_merge_core_outcome_r2_manifest(uuid,text,integer,jsonb,timestamp with time zone)') IS NOT NULL
    OR to_regprocedure('dna.finalize_race_merge_core_outcome_r2_generation(uuid,text,integer,text,timestamp with time zone)') IS NOT NULL
    OR to_regprocedure('dna.read_race_merge_core_outcome_r2_manifests(uuid,text,integer,bigint,integer)') IS NOT NULL
    OR to_regprocedure('dna.reject_race_merge_core_outcome_r2_manifest_mutation()') IS NOT NULL THEN
    RAISE EXCEPTION 'Race Merge Core outcome R2 manifest migration was not fully removed';
  END IF;
END $removal$;

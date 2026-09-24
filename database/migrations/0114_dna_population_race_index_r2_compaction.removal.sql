DO $population_r2_compaction_removal$
BEGIN
  IF to_regclass('dna.dna_population_race_index_compact_identity') IS NOT NULL
     OR to_regclass('dna.dna_population_race_index_r2_chunk') IS NOT NULL
     OR to_regprocedure('dna.dna_population_race_index_generation_owned(bigint)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_population_race_index_legacy_chunk(uuid,text,text,integer)') IS NOT NULL
     OR to_regprocedure('dna.register_dna_population_race_index_r2_compaction_chunk(uuid,text,text,jsonb,jsonb,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.finalize_dna_population_race_index_r2_compaction(uuid,text,text,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.lookup_dna_population_race_index_compact_identities(uuid,text,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.register_dna_population_race_index_compact_identity_chunk(uuid,text,text,integer,jsonb,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_population_race_index_r2_chunk_manifests(uuid,text,integer,integer)') IS NOT NULL
     OR to_regprocedure('dna.append_dna_population_race_index_r2_batch(uuid,text,jsonb,jsonb,jsonb,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.retire_dna_population_race_index_legacy_storage(uuid,text,timestamp with time zone)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'dna'
         AND table_name = 'dna_population_race_index_generation'
         AND column_name IN (
           'generation_key', 'storage_layout', 'r2_chunk_count',
           'r2_compacted_race_count', 'r2_identity_chunk_count',
           'r2_last_source_race_id', 'compacted_at',
           'legacy_storage_retired_at'
         )
     )
     OR to_regclass('dna.dna_population_race_index_race_mode_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'population R2 compaction objects remain after reversal';
  END IF;
END
$population_r2_compaction_removal$;

BEGIN;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.dna_population_race_index_generation generation
    WHERE generation.storage_layout <> 'legacy_neon_v1'
       OR generation.legacy_storage_retired_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM dna.dna_population_race_index_compact_identity
  ) OR EXISTS (
    SELECT 1 FROM dna.dna_population_race_index_r2_chunk
  ) THEN
    RAISE EXCEPTION 'population R2 compaction migration contains durable data and cannot be reversed';
  END IF;
END
$guard$;

GRANT EXECUTE ON FUNCTION
  dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone)
TO dna_app_runtime;

DROP FUNCTION IF EXISTS dna.retire_dna_population_race_index_legacy_storage(uuid,text,timestamp with time zone);
DROP FUNCTION IF EXISTS dna.append_dna_population_race_index_r2_batch(uuid,text,jsonb,jsonb,jsonb,timestamp with time zone);
DROP FUNCTION IF EXISTS dna.lookup_dna_population_race_index_compact_identities(uuid,text,jsonb);
DROP FUNCTION IF EXISTS dna.register_dna_population_race_index_compact_identity_chunk(uuid,text,text,integer,jsonb,timestamp with time zone);
DROP FUNCTION IF EXISTS dna.read_dna_population_race_index_r2_chunk_manifests(uuid,text,integer,integer);
DROP FUNCTION IF EXISTS dna.finalize_dna_population_race_index_r2_compaction(uuid,text,text,timestamp with time zone);
DROP FUNCTION IF EXISTS dna.register_dna_population_race_index_r2_compaction_chunk(uuid,text,text,jsonb,jsonb,timestamp with time zone);
DROP FUNCTION IF EXISTS dna.read_dna_population_race_index_legacy_chunk(uuid,text,text,integer);

DROP TABLE IF EXISTS dna.dna_population_race_index_r2_chunk;
DROP TABLE IF EXISTS dna.dna_population_race_index_compact_identity;
DROP FUNCTION IF EXISTS dna.dna_population_race_index_generation_owned(bigint);

ALTER TABLE dna.dna_population_race_index_generation
  DROP CONSTRAINT IF EXISTS dna_population_race_index_generation_compaction_state_check,
  DROP CONSTRAINT IF EXISTS dna_population_race_index_generation_storage_layout_check,
  DROP CONSTRAINT IF EXISTS dna_population_race_index_generation_generation_key_key,
  DROP COLUMN IF EXISTS legacy_storage_retired_at,
  DROP COLUMN IF EXISTS compacted_at,
  DROP COLUMN IF EXISTS r2_last_source_race_id,
  DROP COLUMN IF EXISTS r2_compacted_race_count,
  DROP COLUMN IF EXISTS r2_chunk_count,
  DROP COLUMN IF EXISTS storage_layout,
  DROP COLUMN IF EXISTS generation_key;


COMMIT;

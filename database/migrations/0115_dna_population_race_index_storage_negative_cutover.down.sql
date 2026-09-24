BEGIN;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.dna_population_race_index_generation generation
    WHERE generation.r2_chunk_count <> 0
       OR generation.r2_compacted_race_count <> 0
       OR generation.storage_layout <> 'legacy_neon_v1'
       OR generation.legacy_storage_retired_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM dna.dna_population_race_index_r2_chunk
  ) THEN
    RAISE EXCEPTION 'population storage-negative cutover contains durable data and cannot be reversed';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS retire_population_race_index_chunk_rows
  ON dna.dna_population_race_index_r2_chunk;
DROP FUNCTION IF EXISTS dna.retire_dna_population_race_index_chunk_rows();
DROP FUNCTION IF EXISTS dna.finalize_dna_population_race_index_storage_negative_cutover(uuid,text,text,timestamp with time zone);
DROP FUNCTION IF EXISTS dna.retire_dna_population_race_index_storage_negative_legacy(uuid,text,timestamp with time zone);

COMMIT;

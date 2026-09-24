BEGIN;

CREATE INDEX IF NOT EXISTS dna_population_race_index_race_mode_idx
  ON dna.dna_population_race_index_race(owner_id, generation_id, mode, source_race_id);

COMMIT;

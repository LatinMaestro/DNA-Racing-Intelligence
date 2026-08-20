BEGIN;

-- The worker may write only the reversible pre-activation staging boundary.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dna.import_batch
  TO dna_app_runtime;
GRANT INSERT ON TABLE dna.dataset_staged_record
  TO dna_app_runtime;
GRANT INSERT ON TABLE dna.normalized_race_staged_fact
  TO dna_app_runtime;
GRANT INSERT ON TABLE dna.normalized_core_staged_fact
  TO dna_app_runtime;
GRANT INSERT ON TABLE dna.normalized_arena_staged_fact
  TO dna_app_runtime;

COMMIT;


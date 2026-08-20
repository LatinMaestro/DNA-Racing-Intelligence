BEGIN;

REVOKE INSERT ON TABLE dna.normalized_arena_staged_fact
  FROM dna_app_runtime;
REVOKE INSERT ON TABLE dna.normalized_core_staged_fact
  FROM dna_app_runtime;
REVOKE INSERT ON TABLE dna.normalized_race_staged_fact
  FROM dna_app_runtime;
REVOKE INSERT ON TABLE dna.dataset_staged_record
  FROM dna_app_runtime;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE dna.import_batch
  FROM dna_app_runtime;

COMMIT;


BEGIN;

-- The private Imports workspace needs read-only visibility of active dataset
-- versions while preserving all dataset activation/mutation authority elsewhere.
GRANT SELECT ON TABLE dna.dataset_version
  TO dna_app_runtime;

COMMIT;

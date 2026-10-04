BEGIN;

REVOKE SELECT ON TABLE dna.dataset_version
  FROM dna_app_runtime;

COMMIT;

BEGIN;

REVOKE SELECT ON TABLE
  dna.manual_star_observation,
  dna.identity_review,
  dna.import_warning,
  dna.dataset_version
FROM dna_app_runtime;

COMMIT;

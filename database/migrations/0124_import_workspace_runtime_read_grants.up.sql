BEGIN;

-- The private import workspace reads only owner-scoped status and review metadata.
-- Forced RLS remains authoritative on every relation.
GRANT SELECT ON TABLE
  dna.dataset_version,
  dna.import_warning,
  dna.identity_review,
  dna.manual_star_observation
TO dna_app_runtime;

COMMIT;

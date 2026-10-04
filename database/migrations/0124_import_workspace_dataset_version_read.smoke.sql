BEGIN;

DO $smoke$
BEGIN
  IF NOT has_table_privilege(
    'dna_app_runtime', 'dna.dataset_version', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'runtime Imports workspace dataset_version SELECT grant is missing';
  END IF;

  IF has_table_privilege(
    'dna_app_runtime', 'dna.dataset_version', 'INSERT,UPDATE,DELETE'
  ) THEN
    RAISE EXCEPTION 'runtime Imports workspace must not mutate dataset_version';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class class
    WHERE class.oid = 'dna.dataset_version'::regclass
      AND (NOT class.relrowsecurity OR NOT class.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'dataset_version must retain forced RLS';
  END IF;
END
$smoke$;

ROLLBACK;

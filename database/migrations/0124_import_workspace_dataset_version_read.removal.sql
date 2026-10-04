BEGIN;

DO $removal$
BEGIN
  IF has_table_privilege(
    'dna_app_runtime', 'dna.dataset_version', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'runtime Imports workspace dataset_version SELECT grant remains';
  END IF;
END
$removal$;

ROLLBACK;

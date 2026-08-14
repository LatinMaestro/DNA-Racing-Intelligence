BEGIN;

DO $smoke$
BEGIN
  IF NOT has_table_privilege('dna_app_runtime', 'dna.import_batch', 'SELECT')
    OR NOT has_table_privilege('dna_app_runtime', 'dna.import_batch', 'INSERT')
    OR NOT has_table_privilege('dna_app_runtime', 'dna.import_batch', 'UPDATE')
    OR NOT has_table_privilege('dna_app_runtime', 'dna.import_batch', 'DELETE')
  THEN
    RAISE EXCEPTION 'runtime staging import_batch grants are incomplete';
  END IF;
  IF NOT has_table_privilege(
    'dna_app_runtime', 'dna.dataset_staged_record', 'INSERT'
  ) OR NOT has_table_privilege(
    'dna_app_runtime', 'dna.normalized_race_staged_fact', 'INSERT'
  ) OR NOT has_table_privilege(
    'dna_app_runtime', 'dna.normalized_core_staged_fact', 'INSERT'
  ) OR NOT has_table_privilege(
    'dna_app_runtime', 'dna.normalized_arena_staged_fact', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'runtime normalized staging grants are incomplete';
  END IF;
  IF has_table_privilege(
    'dna_app_runtime', 'dna.dataset_version', 'INSERT,UPDATE,DELETE'
  ) THEN
    RAISE EXCEPTION 'runtime staging role must not activate a dataset';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class class
    WHERE class.oid = ANY(ARRAY[
      'dna.import_batch'::regclass,
      'dna.dataset_staged_record'::regclass,
      'dna.normalized_race_staged_fact'::regclass,
      'dna.normalized_core_staged_fact'::regclass,
      'dna.normalized_arena_staged_fact'::regclass
    ]) AND (NOT class.relrowsecurity OR NOT class.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'runtime staging boundary must keep forced RLS';
  END IF;
END
$smoke$;

ROLLBACK;

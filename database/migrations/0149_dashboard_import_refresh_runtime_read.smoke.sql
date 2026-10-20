BEGIN;

DO $permissions$
BEGIN
  IF NOT has_table_privilege(
    'dna_app_runtime',
    'dna.aggregate_refresh_job',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'Dashboard import refresh runtime SELECT grant is missing';
  END IF;

  IF has_table_privilege(
    'dna_app_runtime',
    'dna.aggregate_refresh_job',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) THEN
    RAISE EXCEPTION
      'Dashboard import refresh runtime grant is not read-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'dna'
      AND relation.relname = 'aggregate_refresh_job'
      AND (
        NOT relation.relrowsecurity
        OR NOT relation.relforcerowsecurity
      )
  ) THEN
    RAISE EXCEPTION
      'Dashboard import refresh relation must keep forced RLS';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1490000-0000-4000-8000-000000000001';

DO $runtime_read$
BEGIN
  PERFORM count(*) FROM dna.aggregate_refresh_job;
END
$runtime_read$;

RESET ROLE;
ROLLBACK;

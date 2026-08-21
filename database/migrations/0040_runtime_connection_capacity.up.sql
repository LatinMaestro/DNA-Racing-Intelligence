BEGIN;

DO $runtime_capacity$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'dna_app_runtime'
      AND rolcanlogin
      AND NOT rolsuper
      AND NOT rolcreatedb
      AND NOT rolcreaterole
      AND NOT rolinherit
      AND NOT rolreplication
      AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'least-privilege dna_app_runtime role is unavailable';
  END IF;
END
$runtime_capacity$;

ALTER ROLE dna_app_runtime CONNECTION LIMIT 10;

COMMIT;

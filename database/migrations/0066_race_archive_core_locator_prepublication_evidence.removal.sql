DO $removal$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'dna'
      AND procedure.proname = 'replace_race_archive_core_locators_pre_0066'
  ) THEN
    RAISE EXCEPTION 'pre-0066 Race archive Core locator function survived rollback';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'dna'
      AND procedure.proname = 'replace_race_archive_core_locators'
  ) THEN
    RAISE EXCEPTION 'prior Race archive Core locator function was not restored';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.replace_race_archive_core_locators(uuid,uuid,uuid,character,jsonb,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'restored Race archive Core locator privilege is incomplete';
  END IF;
END
$removal$;

DO $removal$
BEGIN
  IF to_regclass('dna.race_archive_prepublication_evidence_receipt') IS NOT NULL THEN
    RAISE EXCEPTION 'Race archive pre-publication evidence table survived rollback';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'dna'
      AND procedure.proname IN (
        'race_archive_prepublication_evidence_summary',
        'prepare_race_archive_prepublication_evidence',
        'list_race_archive_refresh_versions_pre_0065',
        'seal_dataset_version_evidence_pre_0065'
      )
  ) THEN
    RAISE EXCEPTION 'Race archive pre-publication helper survived rollback';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'dna'
      AND procedure.proname = 'list_race_archive_aggregate_refresh_versions'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'dna'
      AND procedure.proname = 'seal_dataset_version_evidence'
  ) THEN
    RAISE EXCEPTION 'prior Race archive evidence contract was not restored';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.seal_dataset_version_evidence(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'restored Race archive evidence privileges are incomplete';
  END IF;
END
$removal$;

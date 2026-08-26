DO $race_entry_archive_compaction_removal$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'dna'
      AND relation.relname = 'race_entry_archive_compaction_receipt'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc proc
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'dna'
      AND proc.proname IN (
        'compact_published_race_entries',
        'publish_pro_league_aggregate_refresh_pre_entry_compact'
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc proc
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'dna'
      AND proc.proname = 'publish_pro_league_aggregate_refresh'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.publish_pro_league_aggregate_refresh(uuid,uuid,uuid,text,uuid,character,integer,bigint,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Race entry archive compaction did not reverse cleanly';
  END IF;
END
$race_entry_archive_compaction_removal$;

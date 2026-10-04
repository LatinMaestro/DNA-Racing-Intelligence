BEGIN;

DO $smoke$
DECLARE
  v_relation text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'dna.dataset_version',
    'dna.import_warning',
    'dna.identity_review',
    'dna.manual_star_observation'
  ]
  LOOP
    IF NOT has_table_privilege('dna_app_runtime', v_relation, 'SELECT') THEN
      RAISE EXCEPTION 'runtime import workspace SELECT grant is missing for %',
        v_relation;
    END IF;
    IF has_table_privilege('dna_app_runtime', v_relation, 'INSERT')
      OR has_table_privilege('dna_app_runtime', v_relation, 'UPDATE')
      OR has_table_privilege('dna_app_runtime', v_relation, 'DELETE')
      OR has_table_privilege('dna_app_runtime', v_relation, 'TRUNCATE')
      OR has_table_privilege('dna_app_runtime', v_relation, 'REFERENCES')
      OR has_table_privilege('dna_app_runtime', v_relation, 'TRIGGER')
    THEN
      RAISE EXCEPTION 'runtime import workspace grant is not read-only for %',
        v_relation;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'dna'
      AND relation.relname = ANY(ARRAY[
        'dataset_version',
        'import_warning',
        'identity_review',
        'manual_star_observation'
      ])
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'runtime import workspace relations must keep forced RLS';
  END IF;
END
$smoke$;

ROLLBACK;

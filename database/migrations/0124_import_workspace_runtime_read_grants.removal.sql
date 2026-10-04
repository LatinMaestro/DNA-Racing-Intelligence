DO $removal$
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
    IF has_table_privilege('dna_app_runtime', v_relation, 'SELECT') THEN
      RAISE EXCEPTION 'runtime import workspace grant was not removed for %',
        v_relation;
    END IF;
  END LOOP;
END
$removal$;

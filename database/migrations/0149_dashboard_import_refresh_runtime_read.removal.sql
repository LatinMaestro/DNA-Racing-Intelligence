DO $removal$
BEGIN
  IF has_table_privilege(
    'dna_app_runtime',
    'dna.aggregate_refresh_job',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'Dashboard import refresh runtime read grant was not removed';
  END IF;
END
$removal$;

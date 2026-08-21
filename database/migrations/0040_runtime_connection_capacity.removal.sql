DO $runtime_capacity_removal$
BEGIN
  IF COALESCE((
    SELECT rolconnlimit
    FROM pg_catalog.pg_roles
    WHERE rolname = 'dna_app_runtime'
  ), 0) <> -1 THEN
    RAISE EXCEPTION 'runtime role connection cap did not reverse';
  END IF;
END
$runtime_capacity_removal$;

DO $import_dataset_rollback_removal$
BEGIN
  IF to_regclass('dna.import_dataset_rollback') IS NOT NULL
     OR to_regprocedure(
       'dna.rollback_active_source_version(uuid,uuid,text,text,timestamp with time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'import dataset rollback boundary was not removed';
  END IF;
END
$import_dataset_rollback_removal$;

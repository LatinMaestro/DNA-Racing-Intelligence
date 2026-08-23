DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.cleanup_confirmed_import_before_dispatch(uuid,uuid,character,text,character,uuid,uuid,text,timestamp with time zone)'
  ) IS NOT NULL
     OR to_regclass('dna.import_confirmation_cleanup') IS NOT NULL THEN
    RAISE EXCEPTION 'confirmed import cleanup objects still exist';
  END IF;
END
$removal$;

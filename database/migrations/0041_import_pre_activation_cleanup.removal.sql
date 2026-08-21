DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.cleanup_import_before_activation(uuid,uuid,character,text,timestamp with time zone)'
  ) IS NOT NULL
     OR to_regclass('dna.import_pre_activation_cleanup') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-activation cleanup objects still exist';
  END IF;
END
$removal$;

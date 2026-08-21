DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.assert_import_activation_ready(uuid,text,character)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'activation readiness function still exists';
  END IF;
  IF to_regprocedure(
    'dna.prepare_import_activation_dataset(uuid,uuid,uuid,character,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'import activation dataset preparation function still exists';
  END IF;
END
$removal$;

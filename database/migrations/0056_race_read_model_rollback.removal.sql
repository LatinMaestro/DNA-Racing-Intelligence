DO $race_read_model_rollback_removal$
BEGIN
  IF to_regprocedure(
    'dna.rollback_active_dataset_pre_read_model(text,text,timestamptz)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'pre-read-model rollback helper was not removed';
  END IF;

  IF to_regprocedure(
    'dna.rollback_active_dataset(text,text,timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'dataset rollback function was not restored';
  END IF;
END
$race_read_model_rollback_removal$;

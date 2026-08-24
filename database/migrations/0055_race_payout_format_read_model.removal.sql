DO $race_payout_format_read_model_removal$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'dna'
      AND table_name = 'race_entry'
      AND column_name = 'payout_format_label'
  ) THEN
    RAISE EXCEPTION 'Race payout read-model column was not removed';
  END IF;

  IF to_regprocedure(
    'dna.refresh_core_payout_format_profiles_pre_read_model(timestamptz)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'pre-read-model payout refresh helper was not removed';
  END IF;

  IF to_regprocedure(
    'dna.refresh_core_payout_format_profiles(timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'payout refresh function was not restored';
  END IF;
END
$race_payout_format_read_model_removal$;

DO $race_economic_archive_identity_removal$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'dna'
      AND table_name = 'economic_transaction'
      AND column_name IN ('race_source_event_id', 'race_source_core_id')
  ) THEN
    RAISE EXCEPTION 'economic transaction archive identity columns were not removed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'dna'
      AND table_name = 'race_economic_contribution'
      AND column_name IN ('race_source_event_id', 'race_source_core_id')
  ) THEN
    RAISE EXCEPTION 'race economic contribution archive identity columns were not removed';
  END IF;

  IF to_regprocedure(
    'dna.bind_race_economic_transaction_archive_identity()'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'race transaction archive identity trigger function was not removed';
  END IF;

  IF to_regprocedure(
    'dna.bind_race_economic_contribution_archive_identity()'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'race contribution archive identity trigger function was not removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid = 'dna.economic_transaction'::regclass
      AND con.contype = 'f'
      AND con.confrelid = 'dna.race_entry'::regclass
  ) THEN
    RAISE EXCEPTION 'economic transaction race-entry foreign key was not restored';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid = 'dna.race_economic_contribution'::regclass
      AND con.contype = 'f'
      AND con.confrelid = 'dna.race_entry'::regclass
  ) THEN
    RAISE EXCEPTION 'race contribution race-entry foreign key was not restored';
  END IF;
END
$race_economic_archive_identity_removal$;

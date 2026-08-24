DO $race_entry_identity_binding_removal$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'dna'
      AND table_name = 'race_entry'
      AND column_name = 'source_fingerprint_sha256'
  ) THEN
    RAISE EXCEPTION 'Race Merge compact identity column was not removed';
  END IF;

  IF to_regprocedure(
    'dna.accept_staged_race_dataset_pre_identity(uuid,uuid,timestamptz,timestamptz,timestamptz)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Race Merge pre-identity helper was not removed';
  END IF;

  IF to_regprocedure(
    'dna.accept_staged_race_dataset(uuid,uuid,timestamptz,timestamptz,timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Race Merge acceptance function was not restored';
  END IF;
END
$race_entry_identity_binding_removal$;

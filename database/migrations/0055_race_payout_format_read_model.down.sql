BEGIN;

REVOKE ALL ON FUNCTION dna.refresh_core_payout_format_profiles(timestamptz)
  FROM PUBLIC;

DROP FUNCTION dna.refresh_core_payout_format_profiles(timestamptz);

ALTER FUNCTION dna.refresh_core_payout_format_profiles_pre_read_model(
  timestamptz
) RENAME TO refresh_core_payout_format_profiles;

ALTER TABLE dna.race_entry
  DROP COLUMN payout_format_label;

COMMIT;

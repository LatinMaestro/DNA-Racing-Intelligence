BEGIN;

DROP FUNCTION IF EXISTS dna.list_core_payout_format_profiles(uuid, text, integer);
DROP FUNCTION IF EXISTS dna.refresh_core_payout_format_profiles(timestamptz);
DROP TABLE IF EXISTS dna.core_payout_format_profile;
DROP FUNCTION IF EXISTS dna.payout_format_key(text);

COMMIT;

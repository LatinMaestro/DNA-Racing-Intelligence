BEGIN;

DROP FUNCTION IF EXISTS dna.list_core_performance_profiles(uuid, text, integer);
DROP FUNCTION IF EXISTS dna.refresh_core_performance_profiles(timestamptz);
DROP TABLE IF EXISTS dna.core_performance_profile;
DROP FUNCTION IF EXISTS dna.elapsed_seconds_to_milliseconds(text);

COMMIT;

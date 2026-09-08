BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_daily_refresh_last_good(uuid);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_daily_refresh_generation(uuid, text);
DROP FUNCTION IF EXISTS dna.publish_dna_open_lab_daily_refresh_generation(
  uuid, text, text, text, text, uuid, bigint, bigint, bigint, timestamptz
);
DROP TABLE IF EXISTS dna.dna_open_lab_daily_refresh_active;
DROP TABLE IF EXISTS dna.dna_open_lab_daily_refresh_generation;

COMMIT;

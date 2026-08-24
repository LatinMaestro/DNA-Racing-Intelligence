BEGIN;

DROP FUNCTION IF EXISTS dna.list_race_archive_core_locators(uuid, text, integer);
DROP FUNCTION IF EXISTS dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
);
DROP TABLE IF EXISTS dna.race_archive_core_locator_receipt;
DROP TABLE IF EXISTS dna.race_archive_core_locator;

COMMIT;
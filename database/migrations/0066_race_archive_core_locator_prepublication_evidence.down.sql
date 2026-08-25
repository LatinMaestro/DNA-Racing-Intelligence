BEGIN;

REVOKE ALL ON FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
) FROM dna_app_runtime;
DROP FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
);

ALTER FUNCTION dna.replace_race_archive_core_locators_pre_0066(
  uuid, uuid, uuid, character, jsonb, timestamptz
) RENAME TO replace_race_archive_core_locators;

GRANT EXECUTE ON FUNCTION dna.replace_race_archive_core_locators(
  uuid, uuid, uuid, character, jsonb, timestamptz
) TO dna_app_runtime;

COMMIT;

BEGIN;

DROP FUNCTION IF EXISTS dna.refresh_star_profiles(uuid, timestamptz);
DROP TABLE IF EXISTS dna.core_star_profile;

DROP INDEX IF EXISTS dna.race_entry_active_star_refresh;
DROP INDEX IF EXISTS dna.race_event_active_star_refresh;

DELETE FROM dna.event_star_validation;

ALTER TABLE dna.event_star_validation
  DROP CONSTRAINT IF EXISTS event_star_validation_gold_unique_check,
  DROP CONSTRAINT IF EXISTS event_star_validation_blue_unique_check,
  DROP CONSTRAINT IF EXISTS event_star_validation_gold_array_check,
  DROP CONSTRAINT IF EXISTS event_star_validation_blue_array_check,
  DROP CONSTRAINT IF EXISTS event_star_validation_gold_opportunity_check,
  DROP CONSTRAINT IF EXISTS event_star_validation_blue_opportunity_check,
  DROP CONSTRAINT IF EXISTS event_star_validation_entry_count_check,
  DROP COLUMN IF EXISTS entry_count,
  DROP COLUMN IF EXISTS gold_source_core_ids,
  DROP COLUMN IF EXISTS blue_source_core_ids,
  DROP COLUMN IF EXISTS gold_data_complete,
  DROP COLUMN IF EXISTS blue_data_complete,
  DROP COLUMN IF EXISTS gold_assignment_opportunity,
  DROP COLUMN IF EXISTS blue_assignment_opportunity,
  ADD CONSTRAINT event_star_validation_gold_legacy_check CHECK (
    (gold_assignment_count = 0 AND gold_source_core_id IS NULL)
    OR (gold_assignment_count > 0 AND gold_source_core_id IS NOT NULL)
  ),
  ADD CONSTRAINT event_star_validation_blue_legacy_check CHECK (
    (blue_assignment_count = 0 AND blue_source_core_id IS NULL)
    OR (blue_assignment_count > 0 AND blue_source_core_id IS NOT NULL)
  );

COMMIT;

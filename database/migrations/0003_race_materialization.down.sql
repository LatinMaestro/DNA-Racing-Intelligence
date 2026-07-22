BEGIN;

DROP FUNCTION IF EXISTS dna.rollback_active_dataset(
  text,
  text,
  timestamptz
);

ALTER FUNCTION dna.rollback_active_dataset_ledger(
  text,
  text,
  timestamptz
) RENAME TO rollback_active_dataset;

DROP FUNCTION IF EXISTS dna.accept_staged_race_dataset(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
);

DROP TABLE IF EXISTS dna.normalized_race_staged_fact;

ALTER TABLE dna.race_entry_source
  DROP COLUMN IF EXISTS source_event_datetime,
  DROP COLUMN IF EXISTS source_core_name,
  DROP COLUMN IF EXISTS source_gate,
  DROP COLUMN IF EXISTS raw_elapsed_time,
  DROP COLUMN IF EXISTS raw_prize,
  DROP COLUMN IF EXISTS raw_asset,
  DROP COLUMN IF EXISTS source_format_label,
  DROP COLUMN IF EXISTS source_race_class;

ALTER TABLE dna.race_entry
  DROP COLUMN IF EXISTS active_in_dataset;

ALTER TABLE dna.race_event
  DROP COLUMN IF EXISTS active_in_dataset;

REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text,
  text,
  timestamptz
) FROM PUBLIC;

COMMIT;

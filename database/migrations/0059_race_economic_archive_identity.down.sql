BEGIN;

DROP TRIGGER bind_race_economic_contribution_archive_identity
  ON dna.race_economic_contribution;
DROP TRIGGER bind_race_economic_transaction_archive_identity
  ON dna.economic_transaction;

DROP FUNCTION dna.bind_race_economic_contribution_archive_identity();
DROP FUNCTION dna.bind_race_economic_transaction_archive_identity();

DROP INDEX dna.race_economic_contribution_archive_identity;
DROP INDEX dna.economic_transaction_race_archive_identity;

ALTER TABLE dna.race_economic_contribution
  DROP CONSTRAINT race_economic_contribution_archive_identity_check;

ALTER TABLE dna.economic_transaction
  DROP CONSTRAINT economic_transaction_race_archive_identity_check;

ALTER TABLE dna.race_economic_contribution
  ADD CONSTRAINT race_economic_contribution_owner_id_race_entry_id_fkey
  FOREIGN KEY (owner_id, race_entry_id)
    REFERENCES dna.race_entry(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE dna.economic_transaction
  ADD CONSTRAINT economic_transaction_owner_id_race_entry_id_fkey
  FOREIGN KEY (owner_id, race_entry_id)
    REFERENCES dna.race_entry(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE dna.race_economic_contribution
  DROP COLUMN race_source_core_id,
  DROP COLUMN race_source_event_id;

ALTER TABLE dna.economic_transaction
  DROP COLUMN race_source_core_id,
  DROP COLUMN race_source_event_id;

COMMIT;
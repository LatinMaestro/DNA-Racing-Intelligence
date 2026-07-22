BEGIN;

DROP FUNCTION IF EXISTS dna.rollback_active_dataset(text, text, timestamptz);
ALTER FUNCTION dna.rollback_active_dataset_pre_snapshot(
  text, text, timestamptz
) RENAME TO rollback_active_dataset;

DROP FUNCTION IF EXISTS dna.accept_staged_arena_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
);
DROP FUNCTION IF EXISTS dna.accept_staged_vault_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
);

DROP VIEW IF EXISTS dna.current_arena_snapshot_entry;
DROP VIEW IF EXISTS dna.current_vault_snapshot_entry;
DROP TABLE IF EXISTS dna.arena_snapshot_entry;
DROP TABLE IF EXISTS dna.vault_snapshot_entry;
DROP TABLE IF EXISTS dna.normalized_arena_staged_fact;
DROP TABLE IF EXISTS dna.normalized_vault_staged_fact;

COMMIT;

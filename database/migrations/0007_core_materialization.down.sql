BEGIN;

DROP FUNCTION IF EXISTS dna.refresh_core_lineage(timestamptz);
ALTER FUNCTION dna.refresh_core_lineage_unfiltered(timestamptz)
  RENAME TO refresh_core_lineage;

DROP FUNCTION IF EXISTS dna.rollback_active_dataset(
  text,
  text,
  timestamptz
);
ALTER FUNCTION dna.rollback_active_dataset_pre_core(
  text,
  text,
  timestamptz
) RENAME TO rollback_active_dataset;

DROP FUNCTION IF EXISTS dna.accept_staged_core_dataset(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
);

DROP FUNCTION IF EXISTS dna.evaluate_family_pair(uuid, uuid);
ALTER FUNCTION dna.evaluate_family_pair_graph(uuid, uuid)
  RENAME TO evaluate_family_pair;

DROP VIEW IF EXISTS dna.active_core_details;
DROP TABLE IF EXISTS dna.core_parent_import_provenance;
DROP TABLE IF EXISTS dna.normalized_core_staged_fact;

DROP INDEX IF EXISTS dna.core_parent_one_active_known_role;
DELETE FROM dna.core_parent
WHERE NOT active_in_core_details;
ALTER TABLE dna.core_parent
  DROP COLUMN IF EXISTS active_in_core_details;
CREATE UNIQUE INDEX core_parent_one_known_role
  ON dna.core_parent(owner_id, child_core_id, parent_role)
  WHERE parent_role <> 'unknown';

COMMIT;

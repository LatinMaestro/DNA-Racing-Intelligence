BEGIN;

GRANT EXECUTE ON FUNCTION dna.stage_dna_open_lab_sync_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb
) TO dna_app_runtime;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_serving_owned_cores(uuid);
DROP TRIGGER IF EXISTS enforce_dna_open_lab_materialized_publication
  ON dna.dna_open_lab_sync_generation;
DROP FUNCTION IF EXISTS dna.enforce_dna_open_lab_materialized_publication();
DROP FUNCTION IF EXISTS dna.stage_dna_open_lab_materialized_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb
);
DROP TABLE IF EXISTS dna.dna_open_lab_owned_core_snapshot;
ALTER TABLE dna.dna_open_lab_sync_generation
  DROP COLUMN IF EXISTS materialization_contract_version;

COMMIT;

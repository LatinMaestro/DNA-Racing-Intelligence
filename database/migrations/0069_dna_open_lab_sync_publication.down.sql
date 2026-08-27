BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_sync_state(uuid);
DROP FUNCTION IF EXISTS dna.pause_dna_open_lab_sync(
  uuid, text, timestamptz, integer
);
DROP FUNCTION IF EXISTS dna.publish_dna_open_lab_sync_candidate(
  uuid, uuid, timestamptz
);
DROP FUNCTION IF EXISTS dna.stage_dna_open_lab_sync_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb
);
DROP TABLE IF EXISTS dna.dna_open_lab_sync_state;
DROP TABLE IF EXISTS dna.dna_open_lab_sync_family;
DROP TABLE IF EXISTS dna.dna_open_lab_sync_generation;

COMMIT;

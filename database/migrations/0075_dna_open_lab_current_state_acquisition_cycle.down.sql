BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_current_state_acquisition_cycle(
  uuid, uuid
);
DROP FUNCTION IF EXISTS dna.save_dna_open_lab_current_state_acquisition_cycle(
  uuid, uuid, bigint, jsonb
);
DROP FUNCTION IF EXISTS dna.validate_dna_open_lab_current_state_acquisition_cycle(
  uuid, jsonb
);
DROP TABLE IF EXISTS dna.dna_open_lab_current_state_acquisition_cycle;

COMMIT;

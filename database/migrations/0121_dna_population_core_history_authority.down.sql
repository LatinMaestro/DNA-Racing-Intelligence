BEGIN;

REVOKE ALL ON FUNCTION
  dna.begin_dna_population_core_history_acquisition_attempt(uuid,jsonb,jsonb)
FROM dna_app_runtime;
DROP FUNCTION dna.begin_dna_population_core_history_acquisition_attempt(
  uuid, jsonb, jsonb
);
DROP TRIGGER dna_population_core_history_authority_immutable
  ON dna.dna_population_core_history_authority;
DROP FUNCTION dna.reject_dna_population_core_history_authority_mutation();
DROP TABLE dna.dna_population_core_history_authority;

ALTER TABLE dna.dna_core_race_history_acquisition_cycle
  ADD CONSTRAINT dna_core_race_history_acquisition_cycle_generation_fk
  FOREIGN KEY (owner_id, current_state_generation_id)
  REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
  ON DELETE RESTRICT;

COMMIT;

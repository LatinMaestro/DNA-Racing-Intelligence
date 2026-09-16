BEGIN;

REVOKE ALL ON FUNCTION dna.begin_dna_core_race_history_generation_v2(uuid,text,jsonb) FROM dna_app_runtime;
DROP FUNCTION dna.begin_dna_core_race_history_generation_v2(uuid,text,jsonb);
GRANT EXECUTE ON FUNCTION dna.begin_dna_core_race_history_generation(uuid,text,jsonb) TO dna_app_runtime;

ALTER TABLE dna.dna_core_race_history_generation
  DROP CONSTRAINT dna_core_race_history_generation_result_coverage_check;

ALTER TABLE dna.dna_core_race_history_generation
  ADD CONSTRAINT dna_core_race_history_generation_result_coverage_v1_check CHECK (
    input_result_count = observation_count + replay_duplicate_count
  );

ALTER TABLE dna.dna_core_race_history_generation
  DROP COLUMN entrant_authority_omission_count;

COMMIT;

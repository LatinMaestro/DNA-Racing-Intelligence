BEGIN;

REVOKE ALL ON FUNCTION dna.read_race_merge_core_outcomes(uuid,text,bigint) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.abort_race_merge_outcome_generation(uuid,text,text) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.complete_race_merge_outcome_generation(uuid,text,text,integer,bigint,text) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_race_merge_outcome_digest_page(uuid,text,bigint,text,integer) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.inspect_race_merge_outcome_generation(uuid,text,text,jsonb) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_race_merge_outcome_object_receipt(uuid,text,text) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.commit_race_merge_outcome_object(uuid,text,text,jsonb) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.append_race_merge_outcomes(uuid,text,text,jsonb) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.begin_race_merge_outcome_object(uuid,text,text,text,bigint,text) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.race_merge_outcome_generation_owned(bigint) FROM dna_app_runtime;

DROP FUNCTION dna.read_race_merge_core_outcomes(uuid,text,bigint);
DROP FUNCTION dna.abort_race_merge_outcome_generation(uuid,text,text);
DROP FUNCTION dna.complete_race_merge_outcome_generation(uuid,text,text,integer,bigint,text);
DROP FUNCTION dna.read_race_merge_outcome_digest_page(uuid,text,bigint,text,integer);
DROP FUNCTION dna.inspect_race_merge_outcome_generation(uuid,text,text,jsonb);
DROP FUNCTION dna.read_race_merge_outcome_object_receipt(uuid,text,text);
DROP FUNCTION dna.commit_race_merge_outcome_object(uuid,text,text,jsonb);
DROP FUNCTION dna.append_race_merge_outcomes(uuid,text,text,jsonb);
DROP FUNCTION dna.begin_race_merge_outcome_object(uuid,text,text,text,bigint,text);
DROP TABLE dna.race_merge_outcome;
DROP TABLE dna.race_merge_outcome_object;
DROP TABLE dna.race_merge_outcome_generation;
DROP FUNCTION dna.race_merge_outcome_generation_owned(bigint);

COMMIT;

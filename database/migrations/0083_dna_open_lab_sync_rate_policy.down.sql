BEGIN;
REVOKE ALL ON FUNCTION dna.record_dna_open_lab_rate_observation(uuid,boolean,integer,timestamptz) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.set_dna_open_lab_sync_rate_policy(uuid,integer,timestamptz,bigint,timestamptz) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_sync_rate_policy(uuid) FROM dna_app_runtime;
DROP FUNCTION dna.record_dna_open_lab_rate_observation(uuid,boolean,integer,timestamptz);
DROP FUNCTION dna.set_dna_open_lab_sync_rate_policy(uuid,integer,timestamptz,bigint,timestamptz);
DROP FUNCTION dna.read_dna_open_lab_sync_rate_policy(uuid);
DROP TABLE dna.dna_open_lab_sync_rate_policy;
COMMIT;

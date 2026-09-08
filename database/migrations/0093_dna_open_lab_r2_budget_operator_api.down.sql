BEGIN;
REVOKE ALL ON FUNCTION dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint) FROM dna_app_runtime;
DROP FUNCTION dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint);
DROP FUNCTION dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint);
GRANT EXECUTE ON FUNCTION dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamptz) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamptz) TO dna_app_runtime;
COMMIT;

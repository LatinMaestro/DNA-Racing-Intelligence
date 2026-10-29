BEGIN;
REVOKE ALL ON FUNCTION dna.read_pro_league_full_gate_plan(uuid,text) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.store_pro_league_full_gate_plan(uuid,text,text,text,text,jsonb) FROM dna_app_runtime;
DROP FUNCTION dna.read_pro_league_full_gate_plan(uuid,text);
DROP FUNCTION dna.store_pro_league_full_gate_plan(uuid,text,text,text,text,jsonb);
DROP TABLE dna.pro_league_full_gate_assignment_snapshot;
DROP TABLE dna.pro_league_full_gate_plan;
COMMIT;

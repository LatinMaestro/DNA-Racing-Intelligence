BEGIN;

DROP FUNCTION IF EXISTS dna.list_active_pro_league_evidence_rows(uuid,text,integer,integer);
DROP FUNCTION IF EXISTS dna.read_active_pro_league_evidence_generation(uuid);
DROP FUNCTION IF EXISTS dna.publish_pro_league_evidence_generation(uuid,uuid,text,integer,integer,bigint,character,timestamptz);
DROP FUNCTION IF EXISTS dna.stage_pro_league_evidence_rows(uuid,uuid,text,text,integer,jsonb);
DROP FUNCTION IF EXISTS dna.begin_pro_league_evidence_generation(uuid,uuid,uuid,text,character,timestamptz,bigint,bigint,bigint,bigint,bigint,bigint);
DROP TABLE IF EXISTS dna.pro_league_evidence_active;
DROP TABLE IF EXISTS dna.pro_league_evidence_row;
DROP TABLE IF EXISTS dna.pro_league_evidence_stage_row;
DROP TABLE IF EXISTS dna.pro_league_evidence_generation;

COMMIT;

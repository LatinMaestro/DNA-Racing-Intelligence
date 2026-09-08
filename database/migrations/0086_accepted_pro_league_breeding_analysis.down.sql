BEGIN;

DROP FUNCTION IF EXISTS dna.read_accepted_pro_league_breeding_analysis(uuid,text);
DROP FUNCTION IF EXISTS dna.record_accepted_pro_league_breeding_analysis(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,integer,integer,character,text);
DROP TABLE IF EXISTS dna.accepted_pro_league_breeding_analysis;

COMMIT;

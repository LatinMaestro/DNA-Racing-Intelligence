BEGIN;

DROP FUNCTION IF EXISTS dna.read_active_pro_league_breeding_ranking_generation(uuid);
DROP FUNCTION IF EXISTS dna.publish_pro_league_breeding_ranking_generation(uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,integer,character,jsonb,timestamptz);
DROP TABLE IF EXISTS dna.pro_league_breeding_ranking_active;
DROP TABLE IF EXISTS dna.pro_league_breeding_ranking_row;
DROP TABLE IF EXISTS dna.pro_league_breeding_ranking_generation;

COMMIT;

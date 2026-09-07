BEGIN;

DROP FUNCTION IF EXISTS dna.list_pro_league_roster_substitutions(uuid,integer);
DROP FUNCTION IF EXISTS dna.record_pro_league_roster_substitution(
  uuid,integer,integer,text,text,text,text,text,timestamptz,text,text,text,text
);
DROP FUNCTION IF EXISTS dna.read_pro_league_roster_version(uuid,text);
DROP FUNCTION IF EXISTS dna.store_pro_league_roster_version(
  uuid,text,integer,text,text,text,timestamptz,text,text,jsonb
);
DROP TABLE IF EXISTS dna.pro_league_roster_substitution;
DROP TABLE IF EXISTS dna.pro_league_roster_member_snapshot;
DROP TABLE IF EXISTS dna.pro_league_roster_version;

COMMIT;

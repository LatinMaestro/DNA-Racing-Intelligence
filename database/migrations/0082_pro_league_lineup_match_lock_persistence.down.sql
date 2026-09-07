BEGIN;

REVOKE ALL ON FUNCTION dna.read_pro_league_match_lock(uuid,text)
  FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.store_pro_league_match_lock(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,
  text,text,text,text,text,text,text,text
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_pro_league_lineup_version(uuid,text)
  FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.store_pro_league_lineup_version(
  uuid,text,integer,text,text,text,text,text,jsonb
) FROM dna_app_runtime;

DROP FUNCTION dna.read_pro_league_match_lock(uuid,text);
DROP FUNCTION dna.store_pro_league_match_lock(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,
  text,text,text,text,text,text,text,text
);
DROP FUNCTION dna.read_pro_league_lineup_version(uuid,text);
DROP FUNCTION dna.store_pro_league_lineup_version(
  uuid,text,integer,text,text,text,text,text,jsonb
);
DROP TABLE dna.pro_league_match_lock;
DROP TABLE dna.pro_league_lineup_entry_snapshot;
DROP TABLE dna.pro_league_lineup_version;

COMMIT;

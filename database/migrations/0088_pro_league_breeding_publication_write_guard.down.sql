BEGIN;

DROP FUNCTION IF EXISTS dna.assert_current_pro_league_breeding_publication_authority(
  uuid,timestamptz,timestamptz,timestamptz
);

COMMIT;

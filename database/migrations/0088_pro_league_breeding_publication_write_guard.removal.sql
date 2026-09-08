DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.assert_current_pro_league_breeding_publication_authority(uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Pro League breeding publication write guard removal is incomplete';
  END IF;
END
$removal$;

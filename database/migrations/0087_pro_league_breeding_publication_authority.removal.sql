DO $removal$
BEGIN
  IF to_regprocedure('dna.read_current_pro_league_breeding_publication_authority(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Pro League breeding publication authority removal is incomplete';
  END IF;
END
$removal$;

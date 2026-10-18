DO $removal$
BEGIN
  IF to_regclass('dna.tournament_horse_screening_snapshot') IS NOT NULL
    OR to_regclass('dna.tournament_horse_screening_snapshot_active') IS NOT NULL
    OR to_regprocedure('dna.publish_tournament_horse_screening_snapshot(uuid,text,text,text,timestamptz)') IS NOT NULL
    OR to_regprocedure('dna.read_active_tournament_horse_screening_snapshot(uuid)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Tournament Horse screening snapshot removal failed';
  END IF;
END
$removal$;

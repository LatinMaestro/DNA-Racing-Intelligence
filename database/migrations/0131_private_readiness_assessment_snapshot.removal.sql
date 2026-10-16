DO $removal$
BEGIN
  IF to_regclass('dna.private_readiness_assessment_snapshot') IS NOT NULL
    OR to_regprocedure('dna.read_private_readiness_assessment_snapshot(uuid)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'private readiness assessment snapshot migration was not removed';
  END IF;
END
$removal$;

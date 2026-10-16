DO $removal$
BEGIN
  IF to_regclass('dna.lifecycle_ranking_evidence_snapshot') IS NOT NULL
    OR to_regprocedure('dna.read_lifecycle_ranking_evidence_snapshot(uuid)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Lifecycle ranking evidence snapshot migration was not removed';
  END IF;
END
$removal$;

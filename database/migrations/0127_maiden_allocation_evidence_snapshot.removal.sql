DO $removal$
BEGIN
  IF to_regclass('dna.maiden_allocation_evidence_snapshot') IS NOT NULL
    OR to_regprocedure('dna.read_maiden_allocation_evidence_snapshot(uuid)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Maiden allocation evidence snapshot migration was not removed';
  END IF;
END
$removal$;

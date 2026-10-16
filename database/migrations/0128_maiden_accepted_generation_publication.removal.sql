DO $removal$
BEGIN
  IF to_regclass('dna.maiden_allocation_accepted_generation') IS NOT NULL
    OR to_regprocedure('dna.read_maiden_allocation_accepted_generation(uuid)') IS NOT NULL
    OR to_regprocedure('dna.read_maiden_allocation_accepted_source_identity(uuid)') IS NOT NULL
    OR to_regprocedure('dna.publish_maiden_allocation_evidence_snapshot(uuid,text,timestamp with time zone,text,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Maiden accepted generation publication removal incomplete';
  END IF;
END
$removal$;

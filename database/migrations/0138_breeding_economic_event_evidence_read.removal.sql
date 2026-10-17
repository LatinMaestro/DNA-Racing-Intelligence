DO $removal$
BEGIN
  IF to_regprocedure(
      'dna.list_breeding_economic_evidence_by_event(uuid,text,integer)'
    ) IS NOT NULL
    OR to_regclass('dna.breeding_economic_event_evidence_idx') IS NOT NULL
  THEN RAISE EXCEPTION 'breeding event evidence read removal incomplete'; END IF;
END
$removal$;

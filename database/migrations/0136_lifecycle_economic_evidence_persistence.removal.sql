DO $removal$
BEGIN
  IF to_regclass('dna.lifecycle_economic_state') IS NOT NULL
    OR to_regclass('dna.lifecycle_economic_evidence') IS NOT NULL
    OR to_regprocedure('dna.read_lifecycle_economic_write_context(uuid)') IS NOT NULL
    OR to_regprocedure('dna.read_lifecycle_economic_evidence(uuid,text)') IS NOT NULL
    OR to_regprocedure('dna.list_lifecycle_burn_credit_evidence(uuid,text)') IS NOT NULL
    OR to_regprocedure('dna.write_lifecycle_economic_evidence(uuid,text,text,text,character,character,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'lifecycle economic persistence removal incomplete'; END IF;
END
$removal$;

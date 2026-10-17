DO $removal$
BEGIN
  IF to_regclass('dna.breeding_economic_state') IS NOT NULL
    OR to_regclass('dna.breeding_economic_record') IS NOT NULL
    OR to_regclass('dna.breeding_cost_basis_transaction') IS NOT NULL
    OR to_regprocedure('dna.read_breeding_economic_write_context(uuid)') IS NOT NULL
    OR to_regprocedure('dna.read_breeding_economic_record(uuid,text)') IS NOT NULL
    OR to_regprocedure('dna.list_assigned_breeding_cost_transactions(uuid,text[])') IS NOT NULL
    OR to_regprocedure('dna.write_breeding_economic_record(uuid,text,text,character,character,text,text,text[])') IS NOT NULL
  THEN RAISE EXCEPTION 'breeding economic persistence removal incomplete'; END IF;
END
$removal$;

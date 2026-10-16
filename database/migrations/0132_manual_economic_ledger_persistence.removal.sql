DO $removal$
BEGIN
  IF to_regclass('dna.manual_economic_entry') IS NOT NULL
    OR to_regclass('dna.manual_economic_reversal') IS NOT NULL
    OR to_regprocedure('dna.read_manual_economic_write_context(uuid)') IS NOT NULL
    OR to_regprocedure('dna.read_manual_economic_tournament_binding(uuid,text)') IS NOT NULL
    OR to_regprocedure('dna.read_manual_economic_entry(uuid,text)') IS NOT NULL
    OR to_regprocedure('dna.write_manual_economic_entry(uuid,text,character,text,text)') IS NOT NULL
    OR to_regprocedure('dna.write_manual_economic_reversal(uuid,text,text,character,text,character,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'manual economic ledger persistence removal incomplete';
  END IF;
END
$removal$;

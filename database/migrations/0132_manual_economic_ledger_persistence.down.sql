BEGIN;

DO $preserve$
BEGIN
  IF EXISTS (SELECT 1 FROM dna.manual_economic_entry)
    OR EXISTS (SELECT 1 FROM dna.manual_economic_reversal)
  THEN
    RAISE EXCEPTION
      'manual economic evidence exists; preserve it and use a reviewed data rollback';
  END IF;
END
$preserve$;

DROP FUNCTION IF EXISTS dna.write_manual_economic_reversal(
  uuid,text,text,character,text,character,text
);
DROP FUNCTION IF EXISTS dna.write_manual_economic_entry(
  uuid,text,character,text,text
);
DROP FUNCTION IF EXISTS dna.read_manual_economic_entry(uuid,text);
DROP FUNCTION IF EXISTS dna.read_manual_economic_tournament_binding(uuid,text);
DROP FUNCTION IF EXISTS dna.read_manual_economic_write_context(uuid);
DROP TABLE IF EXISTS dna.manual_economic_reversal;
DROP TABLE IF EXISTS dna.manual_economic_entry;

COMMIT;

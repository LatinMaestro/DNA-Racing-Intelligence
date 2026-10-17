BEGIN;
DO $preserve$
BEGIN
  IF EXISTS(SELECT 1 FROM dna.breeding_economic_record) THEN
    RAISE EXCEPTION 'breeding economic evidence exists; preserve it and use a reviewed data rollback';
  END IF;
END
$preserve$;
DROP FUNCTION IF EXISTS dna.write_breeding_economic_record(uuid,text,text,character,character,text,text,text[]);
DROP FUNCTION IF EXISTS dna.list_assigned_breeding_cost_transactions(uuid,text[]);
DROP FUNCTION IF EXISTS dna.read_breeding_economic_record(uuid,text);
DROP FUNCTION IF EXISTS dna.read_breeding_economic_write_context(uuid);
DROP TABLE IF EXISTS dna.breeding_cost_basis_transaction;
DROP TABLE IF EXISTS dna.breeding_economic_record;
DROP TABLE IF EXISTS dna.breeding_economic_state;
COMMIT;

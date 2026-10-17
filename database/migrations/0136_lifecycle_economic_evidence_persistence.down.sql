BEGIN;
DO $preserve$
BEGIN
  IF EXISTS(SELECT 1 FROM dna.lifecycle_economic_evidence) THEN
    RAISE EXCEPTION 'lifecycle economic evidence exists; preserve it and use a reviewed data rollback';
  END IF;
END
$preserve$;
DROP FUNCTION IF EXISTS dna.write_lifecycle_economic_evidence(uuid,text,text,text,character,character,text,text);
DROP FUNCTION IF EXISTS dna.list_lifecycle_burn_credit_evidence(uuid,text);
DROP FUNCTION IF EXISTS dna.read_lifecycle_economic_evidence(uuid,text);
DROP FUNCTION IF EXISTS dna.read_lifecycle_economic_write_context(uuid);
DROP TABLE IF EXISTS dna.lifecycle_economic_evidence;
DROP TABLE IF EXISTS dna.lifecycle_economic_state;
COMMIT;

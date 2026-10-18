DO $checks$
BEGIN
  IF to_regclass('dna.open_race_prediction_reconciliation') IS NOT NULL
    OR to_regprocedure('dna.read_open_race_prediction_reconciliations(uuid,integer)') IS NOT NULL
    OR to_regprocedure('dna.publish_open_race_prediction_reconciliation(uuid,text,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'Open Race prediction reconciliation persistence was not removed'; END IF;
END
$checks$;

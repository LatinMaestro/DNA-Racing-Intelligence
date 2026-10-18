BEGIN;
DROP FUNCTION dna.publish_open_race_prediction_reconciliation(uuid,text,text,text);
DROP FUNCTION dna.read_open_race_prediction_reconciliations(uuid,integer);
DROP TABLE dna.open_race_prediction_reconciliation;
COMMIT;

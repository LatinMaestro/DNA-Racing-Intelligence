BEGIN;
DROP FUNCTION dna.publish_open_race_prediction_snapshot(uuid,text,text,text,text);
DROP FUNCTION dna.read_open_race_prediction_snapshots(uuid,integer);
DROP TABLE dna.open_race_prediction_snapshot;
COMMIT;

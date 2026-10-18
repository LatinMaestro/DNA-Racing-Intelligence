DO $checks$
BEGIN
  IF to_regclass('dna.open_race_prediction_snapshot') IS NOT NULL
    OR to_regprocedure('dna.read_open_race_prediction_snapshots(uuid,integer)') IS NOT NULL
    OR to_regprocedure('dna.publish_open_race_prediction_snapshot(uuid,text,text,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'Open Race prediction persistence was not removed'; END IF;
END
$checks$;

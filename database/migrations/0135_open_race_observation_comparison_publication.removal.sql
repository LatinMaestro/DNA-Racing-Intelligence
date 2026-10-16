DO $removal$
BEGIN
  IF to_regprocedure('dna.publish_open_race_observation_comparison(uuid,text,text,text,timestamp with time zone,text,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Open Race observation publication remains';
  END IF;
END
$removal$;

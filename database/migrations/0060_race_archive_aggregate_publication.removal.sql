DO $removal$
BEGIN
  IF to_regclass('dna.race_archive_aggregate_publication_stage') IS NOT NULL
     OR to_regclass('dna.race_archive_aggregate_publication_stage_row') IS NOT NULL
     OR to_regclass('dna.race_archive_aggregate_publication_receipt') IS NOT NULL THEN
    RAISE EXCEPTION 'Race archive aggregate publication tables remain after reversal';
  END IF;

  IF to_regprocedure(
    'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)'
  ) IS NOT NULL
     OR to_regprocedure(
    'dna.stage_race_archive_aggregate_rows(uuid,uuid,text,text,integer,jsonb)'
  ) IS NOT NULL
     OR to_regprocedure(
    'dna.publish_race_archive_aggregates(uuid,uuid,text,character,bigint,bigint,bigint,bigint,bigint,bigint,timestamp with time zone)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Race archive aggregate publication functions remain after reversal';
  END IF;
END
$removal$;
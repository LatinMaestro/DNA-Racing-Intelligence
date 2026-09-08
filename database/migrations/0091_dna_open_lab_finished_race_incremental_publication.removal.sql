DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_finished_race_incremental_publication') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_finished_race_incremental_active') IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_finished_race_incremental_receipts(uuid,text,integer)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.publish_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer,integer,bigint,bigint,character,timestamp with time zone,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_finished_race_incremental_last_good(uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'finished-race incremental publication removal is incomplete';
  END IF;
END
$removal$;

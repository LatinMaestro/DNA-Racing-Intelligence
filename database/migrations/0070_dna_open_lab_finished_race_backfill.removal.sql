DO $removal$
BEGIN
  IF to_regclass(
       'dna.dna_open_lab_finished_race_backfill_checkpoint'
     ) IS NOT NULL
     OR to_regclass(
       'dna.dna_open_lab_finished_race_window_receipt'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.validate_dna_open_lab_finished_race_backfill_checkpoint(jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.save_dna_open_lab_finished_race_backfill_checkpoint(uuid,bigint,jsonb,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_finished_race_backfill_checkpoint(uuid)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_finished_race_window_receipt(uuid,text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab finished-race backfill objects still exist';
  END IF;
END
$removal$;

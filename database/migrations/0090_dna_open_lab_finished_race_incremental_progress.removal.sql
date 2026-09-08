DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_finished_race_incremental_window_receipt')
       IS NOT NULL
     OR to_regprocedure(
       'dna.save_dna_open_lab_finished_race_incremental_progress(uuid,bigint,jsonb,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'finished-race incremental progress removal is incomplete';
  END IF;
END
$removal$;

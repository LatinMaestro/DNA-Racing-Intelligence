DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_finished_race_incremental_cycle') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_finished_race_incremental_attempt') IS NOT NULL
     OR to_regprocedure('dna.validate_dna_open_lab_finished_race_incremental_cycle(jsonb)') IS NOT NULL
     OR to_regprocedure('dna.save_dna_open_lab_finished_race_incremental_cycle(uuid,bigint,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer)') IS NOT NULL
     OR to_regprocedure('dna.read_latest_complete_dna_finished_race_incremental_cycle(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'finished-race incremental cycle removal is incomplete';
  END IF;
END
$removal$;

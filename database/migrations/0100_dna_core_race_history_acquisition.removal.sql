DO $removal$
BEGIN
  IF to_regclass('dna.dna_core_race_history_acquisition_cycle') IS NOT NULL
     OR to_regclass('dna.dna_core_race_history_acquisition_attempt') IS NOT NULL
     OR to_regclass('dna.dna_core_race_history_core_checkpoint') IS NOT NULL
     OR to_regclass('dna.dna_core_race_history_page_receipt') IS NOT NULL
     OR to_regprocedure('dna.validate_dna_core_race_history_acquisition_cycle(jsonb)') IS NOT NULL
     OR to_regprocedure('dna.validate_dna_core_race_history_checkpoint(jsonb)') IS NOT NULL
     OR to_regprocedure('dna.validate_dna_core_race_history_page_receipt(jsonb)') IS NOT NULL
     OR to_regprocedure('dna.save_dna_core_race_history_acquisition_attempt(uuid,bigint,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.save_dna_core_race_history_page_progress(uuid,bigint,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_core_race_history_acquisition_attempt(uuid,text,integer)') IS NOT NULL
     OR to_regprocedure('dna.read_latest_complete_dna_core_race_history_acquisition(uuid)') IS NOT NULL
     OR to_regprocedure('dna.read_next_dna_core_race_history_checkpoint(uuid,text,integer)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_core_race_history_checkpoints(uuid,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Core race history acquisition removal is incomplete';
  END IF;
END
$removal$;

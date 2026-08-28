DO $removal$
BEGIN
  IF to_regclass(
       'dna.dna_open_lab_current_state_acquisition_cycle'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.validate_dna_open_lab_current_state_acquisition_cycle(uuid,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.save_dna_open_lab_current_state_acquisition_cycle(uuid,uuid,bigint,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_current_state_acquisition_cycle(uuid,uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab current-state acquisition cycle objects still exist';
  END IF;
END
$removal$;

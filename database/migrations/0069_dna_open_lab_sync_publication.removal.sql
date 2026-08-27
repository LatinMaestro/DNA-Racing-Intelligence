DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_sync_generation') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_sync_family') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_sync_state') IS NOT NULL
     OR to_regprocedure(
       'dna.stage_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.pause_dna_open_lab_sync(uuid,text,timestamp with time zone,integer)'
     ) IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_sync_state(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab sync publication objects still exist';
  END IF;
END
$removal$;

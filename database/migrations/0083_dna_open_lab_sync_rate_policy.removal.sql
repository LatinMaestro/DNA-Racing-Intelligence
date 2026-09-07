DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_sync_rate_policy') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_sync_rate_policy(uuid)') IS NOT NULL
     OR to_regprocedure('dna.set_dna_open_lab_sync_rate_policy(uuid,integer,timestamp with time zone,bigint,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.record_dna_open_lab_rate_observation(uuid,boolean,integer,timestamp with time zone)') IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab rate policy removal is incomplete';
  END IF;
END
$removal$;

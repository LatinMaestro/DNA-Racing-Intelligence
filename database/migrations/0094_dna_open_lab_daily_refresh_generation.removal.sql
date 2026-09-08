DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_daily_refresh_generation') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_daily_refresh_active') IS NOT NULL
     OR to_regprocedure(
       'dna.publish_dna_open_lab_daily_refresh_generation(uuid,text,text,text,text,uuid,bigint,bigint,bigint,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_daily_refresh_generation(uuid,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_daily_refresh_last_good(uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'daily refresh generation removal is incomplete';
  END IF;
END
$removal$;

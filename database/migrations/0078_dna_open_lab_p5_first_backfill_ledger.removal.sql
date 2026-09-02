DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_p5_first_backfill_run') IS NOT NULL
     OR to_regclass(
       'dna.dna_open_lab_p5_first_backfill_request_receipt'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.initialize_dna_open_lab_p5_first_backfill_run(uuid,text,text,timestamp with time zone)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.record_dna_open_lab_p5_first_backfill_receipt(uuid,text,bigint,integer,text,timestamp with time zone,text,integer,text,integer,boolean)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.complete_dna_open_lab_p5_first_backfill_run(uuid,text,bigint,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_p5_first_backfill_run(uuid,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_p5_first_backfill_receipts(uuid,text,integer,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'P5 first-backfill ledger objects still exist';
  END IF;
END
$removal$;

DO $removal$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'dna'
      AND table_name = 'dna_open_lab_p5_first_backfill_run'
      AND column_name IN (
        'amendment_measurement_evidence_sha256',
        'amendment_approval_ref_sha256'
      )
  ) OR to_regprocedure(
    'dna.initialize_dna_open_lab_p5_first_backfill_run(uuid,text,text,timestamp with time zone,text)'
  ) IS NOT NULL OR to_regprocedure(
    'dna.record_dna_open_lab_p5_first_backfill_amended_receipt(uuid,text,bigint,integer,text,timestamp with time zone,text,integer,text,integer,boolean)'
  ) IS NOT NULL OR to_regprocedure(
    'dna.complete_dna_open_lab_p5_first_backfill_amended_run(uuid,text,bigint,text)'
  ) IS NOT NULL OR to_regprocedure(
    'dna.read_dna_open_lab_p5_first_backfill_amended_receipts(uuid,text,integer,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'P5 first-backfill amendment objects still exist';
  END IF;
END
$removal$;

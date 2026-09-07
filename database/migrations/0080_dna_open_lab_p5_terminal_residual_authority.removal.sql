DO $removal$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'dna'
      AND table_name = 'dna_open_lab_p5_first_backfill_run'
      AND column_name IN (
        'terminal_checkpoint_measurement_evidence_sha256',
        'terminal_residual_measurement_evidence_sha256',
        'terminal_residual_approval_ref_sha256',
        'maximum_authorized_micro_usd'
      )
  ) OR to_regprocedure(
    'dna.initialize_dna_open_lab_p5_first_backfill_terminal_run(uuid,text,text,timestamp with time zone,text,text)'
  ) IS NOT NULL OR to_regprocedure(
    'dna.record_dna_open_lab_p5_first_backfill_terminal_receipt(uuid,text,bigint,integer,text,timestamp with time zone,text,integer,text,integer,boolean)'
  ) IS NOT NULL OR to_regprocedure(
    'dna.complete_dna_open_lab_p5_first_backfill_terminal_run(uuid,text,bigint,text)'
  ) IS NOT NULL OR to_regprocedure(
    'dna.read_dna_open_lab_p5_first_backfill_terminal_receipts(uuid,text,integer,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'P5 terminal residual authority objects still exist';
  END IF;
END
$removal$;

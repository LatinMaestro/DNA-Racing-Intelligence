BEGIN;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.dna_open_lab_p5_first_backfill_run
    WHERE next_request_ordinal > 17457
       OR logical_request_count > 17456
       OR retained_r2_bytes > 1151165717
  ) OR EXISTS (
    SELECT 1
    FROM dna.dna_open_lab_p5_first_backfill_request_receipt
    WHERE request_ordinal > 17456
  ) THEN
    RAISE EXCEPTION 'cannot reverse terminal P5 authority after residual persistence advanced';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_p5_first_backfill_terminal_receipts(
  uuid, text, integer, integer
);
DROP FUNCTION IF EXISTS dna.complete_dna_open_lab_p5_first_backfill_terminal_run(
  uuid, text, bigint, text
);
DROP FUNCTION IF EXISTS dna.record_dna_open_lab_p5_first_backfill_terminal_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
);
DROP FUNCTION IF EXISTS dna.initialize_dna_open_lab_p5_first_backfill_terminal_run(
  uuid, text, text, timestamptz, text, text
);

ALTER TABLE dna.dna_open_lab_p5_first_backfill_request_receipt
  DROP CONSTRAINT p5_backfill_receipt_ordinal_terminal_check,
  ADD CONSTRAINT p5_backfill_receipt_ordinal_amended_check CHECK (
    request_ordinal BETWEEN 1 AND 17456
  );

ALTER TABLE dna.dna_open_lab_p5_first_backfill_run
  DROP CONSTRAINT p5_backfill_run_next_ordinal_terminal_check,
  DROP CONSTRAINT p5_backfill_run_request_count_terminal_check,
  DROP CONSTRAINT p5_backfill_run_retained_bytes_terminal_check,
  DROP CONSTRAINT p5_backfill_terminal_checkpoint_measurement_sha_check,
  DROP CONSTRAINT p5_backfill_terminal_residual_measurement_sha_check,
  DROP CONSTRAINT p5_backfill_terminal_approval_sha_check,
  DROP CONSTRAINT p5_backfill_terminal_cost_ceiling_check,
  DROP COLUMN terminal_checkpoint_measurement_evidence_sha256,
  DROP COLUMN terminal_residual_measurement_evidence_sha256,
  DROP COLUMN terminal_residual_approval_ref_sha256,
  DROP COLUMN maximum_authorized_micro_usd,
  ADD CONSTRAINT p5_backfill_run_next_ordinal_amended_check CHECK (
    next_request_ordinal BETWEEN 1 AND 17457
  ),
  ADD CONSTRAINT p5_backfill_run_request_count_amended_check CHECK (
    logical_request_count BETWEEN 0 AND 17456
  ),
  ADD CONSTRAINT p5_backfill_run_retained_bytes_amended_check CHECK (
    retained_r2_bytes BETWEEN 0 AND 1151165717
  );

COMMIT;

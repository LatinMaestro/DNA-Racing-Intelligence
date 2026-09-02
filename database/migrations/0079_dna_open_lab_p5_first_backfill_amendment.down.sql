BEGIN;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.dna_open_lab_p5_first_backfill_run
    WHERE next_request_ordinal > 17454
       OR logical_request_count > 17453
       OR retained_r2_bytes > 1151071826
  ) OR EXISTS (
    SELECT 1
    FROM dna.dna_open_lab_p5_first_backfill_request_receipt
    WHERE request_ordinal > 17453
  ) THEN
    RAISE EXCEPTION 'cannot reverse P5 amendment after amended authority advanced';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_p5_first_backfill_amended_receipts(
  uuid, text, integer, integer
);
DROP FUNCTION IF EXISTS dna.complete_dna_open_lab_p5_first_backfill_amended_run(
  uuid, text, bigint, text
);
DROP FUNCTION IF EXISTS dna.record_dna_open_lab_p5_first_backfill_amended_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
);
DROP FUNCTION IF EXISTS dna.initialize_dna_open_lab_p5_first_backfill_run(
  uuid, text, text, timestamptz, text
);

ALTER TABLE dna.dna_open_lab_p5_first_backfill_request_receipt
  DROP CONSTRAINT p5_backfill_receipt_ordinal_amended_check,
  ADD CONSTRAINT p5_backfill_receipt_ordinal_original_check CHECK (
    request_ordinal BETWEEN 1 AND 17453
  );

ALTER TABLE dna.dna_open_lab_p5_first_backfill_run
  DROP CONSTRAINT p5_backfill_run_next_ordinal_amended_check,
  DROP CONSTRAINT p5_backfill_run_request_count_amended_check,
  DROP CONSTRAINT p5_backfill_run_retained_bytes_amended_check,
  DROP CONSTRAINT p5_backfill_amendment_measurement_sha_check,
  DROP CONSTRAINT p5_backfill_amendment_approval_sha_check,
  DROP COLUMN amendment_measurement_evidence_sha256,
  DROP COLUMN amendment_approval_ref_sha256,
  ADD CONSTRAINT p5_backfill_run_next_ordinal_original_check CHECK (
    next_request_ordinal BETWEEN 1 AND 17454
  ),
  ADD CONSTRAINT p5_backfill_run_request_count_original_check CHECK (
    logical_request_count BETWEEN 0 AND 17453
  ),
  ADD CONSTRAINT p5_backfill_run_retained_bytes_original_check CHECK (
    retained_r2_bytes BETWEEN 0 AND 1151071826
  );

COMMIT;

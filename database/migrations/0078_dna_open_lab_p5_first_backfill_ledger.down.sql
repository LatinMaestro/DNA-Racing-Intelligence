BEGIN;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_p5_first_backfill_receipts(
  uuid, text, integer, integer
);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_p5_first_backfill_run(uuid, text);
DROP FUNCTION IF EXISTS dna.complete_dna_open_lab_p5_first_backfill_run(
  uuid, text, bigint, text
);
DROP FUNCTION IF EXISTS dna.record_dna_open_lab_p5_first_backfill_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
);
DROP FUNCTION IF EXISTS dna.initialize_dna_open_lab_p5_first_backfill_run(
  uuid, text, text, timestamptz
);
DROP TABLE IF EXISTS dna.dna_open_lab_p5_first_backfill_request_receipt;
DROP TABLE IF EXISTS dna.dna_open_lab_p5_first_backfill_run;

COMMIT;

BEGIN;

DROP FUNCTION dna.reserve_import_operation(
  uuid,
  text,
  text,
  character,
  timestamptz
);

DROP TABLE dna.import_operation_reservation;

COMMIT;

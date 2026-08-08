BEGIN;

REVOKE EXECUTE ON FUNCTION dna.reserve_import_operation(
  uuid,
  text,
  text,
  character,
  timestamptz
) FROM dna_app_runtime;
REVOKE EXECUTE ON FUNCTION dna.current_owner_id() FROM dna_app_runtime;
REVOKE SELECT, INSERT ON TABLE dna.import_operation_reservation
  FROM dna_app_runtime;
REVOKE SELECT ON TABLE dna.app_owner FROM dna_app_runtime;
REVOKE USAGE ON SCHEMA dna FROM dna_app_runtime;

DROP FUNCTION dna.reserve_import_operation(
  uuid,
  text,
  text,
  character,
  timestamptz
);

DROP TABLE dna.import_operation_reservation;

DROP ROLE dna_app_runtime;

COMMIT;

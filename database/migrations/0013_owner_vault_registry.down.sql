BEGIN;

REVOKE EXECUTE ON FUNCTION dna.set_owner_vault_core(
  uuid,
  uuid,
  boolean,
  boolean,
  bigint,
  text,
  character,
  timestamptz
) FROM dna_app_runtime;
REVOKE SELECT ON TABLE dna.owner_vault_core FROM dna_app_runtime;
REVOKE SELECT ON TABLE dna.core FROM dna_app_runtime;

DROP FUNCTION dna.set_owner_vault_core(
  uuid,
  uuid,
  boolean,
  boolean,
  bigint,
  text,
  character,
  timestamptz
);
DROP TABLE dna.owner_vault_mutation_receipt;
DROP TABLE dna.owner_vault_core;

COMMIT;

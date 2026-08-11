BEGIN;

REVOKE EXECUTE ON FUNCTION dna.search_owner_vault_catalogue(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  integer
) FROM dna_app_runtime;

DROP FUNCTION dna.search_owner_vault_catalogue(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  integer
);

COMMIT;

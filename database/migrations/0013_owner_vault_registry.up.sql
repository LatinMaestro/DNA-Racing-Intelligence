BEGIN;

CREATE TABLE dna.owner_vault_core (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  core_id uuid NOT NULL,
  in_my_vault boolean NOT NULL,
  me_eligible boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, core_id),
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE RESTRICT,
  CHECK (in_my_vault OR NOT me_eligible)
);

CREATE INDEX owner_vault_core_active
  ON dna.owner_vault_core(owner_id, me_eligible, updated_at DESC)
  WHERE in_my_vault;

CREATE TABLE dna.owner_vault_mutation_receipt (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    idempotency_key = btrim(idempotency_key)
    AND idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  request_fingerprint_sha256 character(64) NOT NULL CHECK (
    request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  core_id uuid NOT NULL,
  resulting_in_my_vault boolean NOT NULL,
  resulting_me_eligible boolean NOT NULL,
  resulting_version bigint NOT NULL CHECK (resulting_version > 0),
  requested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE RESTRICT,
  CHECK (resulting_in_my_vault OR NOT resulting_me_eligible)
);

ALTER TABLE dna.owner_vault_core ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.owner_vault_core FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.owner_vault_core
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.owner_vault_mutation_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.owner_vault_mutation_receipt FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.owner_vault_mutation_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.set_owner_vault_core(
  p_owner_id uuid,
  p_core_id uuid,
  p_in_my_vault boolean,
  p_me_eligible boolean,
  p_expected_version bigint,
  p_idempotency_key text,
  p_request_fingerprint_sha256 character(64),
  p_requested_at timestamptz
)
RETURNS TABLE (
  disposition text,
  core_id uuid,
  in_my_vault boolean,
  me_eligible boolean,
  version bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_existing_version bigint;
  v_result dna.owner_vault_core%ROWTYPE;
  v_receipt dna.owner_vault_mutation_receipt%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Vault mutation denied';
  END IF;

  IF p_in_my_vault IS NULL OR p_me_eligible IS NULL THEN
    RAISE EXCEPTION 'Vault state must be explicit';
  END IF;

  IF NOT p_in_my_vault AND p_me_eligible THEN
    RAISE EXCEPTION 'ME eligibility requires an active Vault core';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'expected Vault version is invalid';
  END IF;

  IF
    p_idempotency_key IS NULL
    OR p_idempotency_key <> btrim(p_idempotency_key)
    OR p_idempotency_key !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  THEN
    RAISE EXCEPTION 'Vault idempotency key is invalid';
  END IF;

  IF
    p_request_fingerprint_sha256 IS NULL
    OR p_request_fingerprint_sha256 !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Vault request fingerprint is invalid';
  END IF;

  IF p_requested_at IS NULL THEN
    RAISE EXCEPTION 'Vault mutation timestamp is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_owner_id::text || ':owner_vault_idempotency:' || p_idempotency_key,
      0
    )
  );

  SELECT receipt.*
  INTO v_receipt
  FROM dna.owner_vault_mutation_receipt receipt
  WHERE
    receipt.owner_id = p_owner_id
    AND receipt.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_receipt.request_fingerprint_sha256 <> p_request_fingerprint_sha256 THEN
      RAISE EXCEPTION 'Vault idempotency key was reused with a different request';
    END IF;

    RETURN QUERY
    SELECT
      'replayed'::text,
      v_receipt.core_id,
      v_receipt.resulting_in_my_vault,
      v_receipt.resulting_me_eligible,
      v_receipt.resulting_version,
      v_receipt.requested_at;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.core core_record
    WHERE
      core_record.owner_id = p_owner_id
      AND core_record.id = p_core_id
  ) THEN
    RAISE EXCEPTION 'Vault core is unavailable';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_owner_id::text || ':owner_vault_core:' || p_core_id::text,
      0
    )
  );

  SELECT vault.version
  INTO v_existing_version
  FROM dna.owner_vault_core vault
  WHERE
    vault.owner_id = p_owner_id
    AND vault.core_id = p_core_id
  FOR UPDATE;

  IF COALESCE(v_existing_version, 0) <> p_expected_version THEN
    RAISE EXCEPTION 'Vault state changed; refresh before retrying';
  END IF;

  INSERT INTO dna.owner_vault_core (
    id,
    owner_id,
    core_id,
    in_my_vault,
    me_eligible,
    version,
    updated_at
  )
  VALUES (
    md5(p_owner_id::text || ':owner_vault_core:' || p_core_id::text)::uuid,
    p_owner_id,
    p_core_id,
    p_in_my_vault,
    p_me_eligible,
    p_expected_version + 1,
    p_requested_at
  )
  ON CONFLICT (owner_id, core_id) DO UPDATE
  SET
    in_my_vault = EXCLUDED.in_my_vault,
    me_eligible = EXCLUDED.me_eligible,
    version = EXCLUDED.version,
    updated_at = EXCLUDED.updated_at
  RETURNING owner_vault_core.*
  INTO v_result;

  INSERT INTO dna.owner_vault_mutation_receipt (
    id,
    owner_id,
    idempotency_key,
    request_fingerprint_sha256,
    core_id,
    resulting_in_my_vault,
    resulting_me_eligible,
    resulting_version,
    requested_at
  )
  VALUES (
    md5(
      p_owner_id::text
      || ':owner_vault_mutation:'
      || p_idempotency_key
    )::uuid,
    p_owner_id,
    p_idempotency_key,
    p_request_fingerprint_sha256,
    p_core_id,
    v_result.in_my_vault,
    v_result.me_eligible,
    v_result.version,
    p_requested_at
  );

  RETURN QUERY
  SELECT
    'applied'::text,
    v_result.core_id,
    v_result.in_my_vault,
    v_result.me_eligible,
    v_result.version,
    v_result.updated_at;
END
$function$;

REVOKE ALL ON TABLE dna.owner_vault_core FROM PUBLIC;
REVOKE ALL ON TABLE dna.owner_vault_mutation_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.set_owner_vault_core(
  uuid,
  uuid,
  boolean,
  boolean,
  bigint,
  text,
  character,
  timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.core TO dna_app_runtime;
GRANT SELECT ON TABLE dna.owner_vault_core TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.set_owner_vault_core(
  uuid,
  uuid,
  boolean,
  boolean,
  bigint,
  text,
  character,
  timestamptz
) TO dna_app_runtime;

COMMIT;

BEGIN;

CREATE TABLE dna.import_operation_reservation (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  operation_kind text NOT NULL CHECK (
    operation_kind IN (
      'upload_batch',
      'upload_completion',
      'preview_dispatch',
      'import_activation',
      'import_recovery',
      'aggregate_refresh_retry'
    )
  ),
  idempotency_key text NOT NULL CHECK (
    idempotency_key = btrim(idempotency_key)
    AND idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  request_fingerprint_sha256 character(64) NOT NULL CHECK (
    request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  requested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, operation_kind, idempotency_key)
);

CREATE INDEX import_operation_reservation_recent
  ON dna.import_operation_reservation(
    owner_id,
    operation_kind,
    requested_at DESC
  );

ALTER TABLE dna.import_operation_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_operation_reservation FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.import_operation_reservation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.reserve_import_operation(
  p_owner_id uuid,
  p_operation_kind text,
  p_idempotency_key text,
  p_request_fingerprint_sha256 character(64),
  p_requested_at timestamptz
)
RETURNS TABLE (
  disposition text,
  operation_id uuid,
  request_fingerprint_sha256 character(64)
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_operation_id uuid;
  v_request_fingerprint_sha256 character(64);
  v_created boolean := false;
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped import operation denied';
  END IF;

  INSERT INTO dna.import_operation_reservation (
    id,
    owner_id,
    operation_kind,
    idempotency_key,
    request_fingerprint_sha256,
    requested_at
  )
  VALUES (
    md5(
      p_owner_id::text
      || ':import_operation:'
      || p_operation_kind
      || ':'
      || p_idempotency_key
    )::uuid,
    p_owner_id,
    p_operation_kind,
    p_idempotency_key,
    p_request_fingerprint_sha256,
    p_requested_at
  )
  ON CONFLICT (owner_id, operation_kind, idempotency_key) DO NOTHING
  RETURNING id, import_operation_reservation.request_fingerprint_sha256
  INTO v_operation_id, v_request_fingerprint_sha256;

  IF v_operation_id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT
      reservation.id,
      reservation.request_fingerprint_sha256
    INTO v_operation_id, v_request_fingerprint_sha256
    FROM dna.import_operation_reservation reservation
    WHERE
      reservation.owner_id = p_owner_id
      AND reservation.operation_kind = p_operation_kind
      AND reservation.idempotency_key = p_idempotency_key
    FOR UPDATE;
  END IF;

  IF v_operation_id IS NULL THEN
    RAISE EXCEPTION 'import operation reservation unavailable';
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN v_created THEN 'created' ELSE 'existing' END,
    v_operation_id,
    v_request_fingerprint_sha256;
END
$function$;

REVOKE ALL ON TABLE dna.import_operation_reservation FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.reserve_import_operation(
  uuid,
  text,
  text,
  character,
  timestamptz
) FROM PUBLIC;

COMMIT;

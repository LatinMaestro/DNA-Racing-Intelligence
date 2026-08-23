BEGIN;

CREATE TABLE dna.import_dataset_rollback (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (
    idempotency_key = btrim(idempotency_key)
    AND idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  rolled_back_dataset_version_id uuid NOT NULL,
  rolled_back_batch_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_vault', 'current_arena')
  ),
  restored_dataset_version_id uuid NOT NULL,
  restored_batch_id uuid NOT NULL,
  aggregate_refresh_id uuid NOT NULL,
  reason text NOT NULL CHECK (
    reason = btrim(reason)
    AND length(reason) BETWEEN 10 AND 500
    AND reason !~ '[[:cntrl:]]'
  ),
  requested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (owner_id, rolled_back_dataset_version_id),
  FOREIGN KEY (owner_id, rolled_back_dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, rolled_back_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, restored_dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, restored_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, aggregate_refresh_id)
    REFERENCES dna.aggregate_refresh_job(owner_id, id) ON DELETE RESTRICT
);

ALTER TABLE dna.import_dataset_rollback ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.import_dataset_rollback FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON dna.import_dataset_rollback
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.rollback_active_source_version(
  p_owner_id uuid,
  p_batch_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_requested_at timestamptz
)
RETURNS TABLE (
  status text,
  disposition text,
  rollback_id uuid,
  source_type text,
  restored_batch_id uuid,
  aggregate_refresh_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.import_dataset_rollback%ROWTYPE;
  v_target dna.dataset_version%ROWTYPE;
  v_restored dna.dataset_version%ROWTYPE;
  v_rollback_id uuid := md5(
    p_owner_id::text || ':dataset_rollback:' || p_idempotency_key
  )::uuid;
  v_aggregate_refresh_id uuid := md5(
    p_owner_id::text || ':rollback_aggregate:' || p_idempotency_key
  )::uuid;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped dataset rollback denied';
  END IF;
  IF p_requested_at IS NULL THEN
    RAISE EXCEPTION 'dataset rollback timestamp is required';
  END IF;
  IF p_reason IS NULL
     OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500
     OR btrim(p_reason) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'rollback reason must contain between 10 and 500 printable characters';
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key <> btrim(p_idempotency_key)
     OR p_idempotency_key !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$' THEN
    RAISE EXCEPTION 'dataset rollback idempotency key is invalid';
  END IF;

  SELECT rollback.* INTO v_existing
  FROM dna.import_dataset_rollback rollback
  WHERE rollback.owner_id = p_owner_id
    AND rollback.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.rolled_back_batch_id <> p_batch_id
       OR v_existing.reason <> btrim(p_reason) THEN
      RAISE EXCEPTION 'dataset rollback idempotency conflict';
    END IF;
    RETURN QUERY SELECT
      'restored'::text, 'existing'::text, v_existing.id,
      v_existing.source_type, v_existing.restored_batch_id,
      v_existing.aggregate_refresh_id;
    RETURN;
  END IF;

  SELECT version.* INTO v_target
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.import_batch_id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'not_found'::text, NULL::text, NULL::uuid, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF NOT v_target.is_active OR v_target.rolled_back_at IS NOT NULL THEN
    RETURN QUERY SELECT
      'not_active'::text, NULL::text, NULL::uuid, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF p_requested_at < v_target.activated_at THEN
    RAISE EXCEPTION 'dataset rollback cannot predate activation';
  END IF;

  PERFORM 1
  FROM dna.dataset_stream stream
  WHERE stream.owner_id = p_owner_id
    AND stream.source_type = v_target.source_type
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped dataset stream does not exist';
  END IF;

  SELECT version.* INTO v_restored
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.source_type = v_target.source_type
    AND version.version_number < v_target.version_number
    AND version.rolled_back_at IS NULL
  ORDER BY version.version_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'no_prior_version'::text, NULL::text, NULL::uuid, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  UPDATE dna.dataset_version
  SET is_active = false, rolled_back_at = p_requested_at
  WHERE owner_id = p_owner_id
    AND id = v_target.id
    AND is_active
    AND rolled_back_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active dataset version changed during rollback';
  END IF;

  UPDATE dna.import_batch
  SET status = 'rolled_back',
      rollback_reason = btrim(p_reason),
      rolled_back_at = p_requested_at
  WHERE owner_id = p_owner_id
    AND id = v_target.import_batch_id
    AND status = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active import batch is not accepted';
  END IF;

  UPDATE dna.aggregate_refresh_job
  SET status = 'rolled_back',
      started_at = COALESCE(started_at, p_requested_at),
      completed_at = COALESCE(completed_at, p_requested_at)
  WHERE owner_id = p_owner_id
    AND dataset_version_id = v_target.id
    AND status <> 'rolled_back';

  UPDATE dna.dataset_version
  SET is_active = true, aggregate_refreshed_at = NULL
  WHERE owner_id = p_owner_id
    AND id = v_restored.id
    AND NOT is_active
    AND rolled_back_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prior dataset version is unavailable for restoration';
  END IF;

  INSERT INTO dna.aggregate_refresh_job (
    id, owner_id, dataset_version_id, status, created_at
  ) VALUES (
    v_aggregate_refresh_id, p_owner_id, v_restored.id, 'queued', p_requested_at
  );

  INSERT INTO dna.import_dataset_rollback (
    id, owner_id, idempotency_key, rolled_back_dataset_version_id,
    rolled_back_batch_id, source_type, restored_dataset_version_id,
    restored_batch_id, aggregate_refresh_id, reason, requested_at
  ) VALUES (
    v_rollback_id, p_owner_id, p_idempotency_key, v_target.id,
    v_target.import_batch_id, v_target.source_type, v_restored.id,
    v_restored.import_batch_id, v_aggregate_refresh_id, btrim(p_reason),
    p_requested_at
  );

  RETURN QUERY SELECT
    'restored'::text, 'created'::text, v_rollback_id, v_target.source_type,
    v_restored.import_batch_id, v_aggregate_refresh_id;
END
$function$;

REVOKE ALL ON TABLE dna.import_dataset_rollback FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_source_version(
  uuid, uuid, text, text, timestamptz
) FROM PUBLIC;
GRANT SELECT ON TABLE dna.import_dataset_rollback TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.rollback_active_source_version(
  uuid, uuid, text, text, timestamptz
) TO dna_app_runtime;

COMMIT;

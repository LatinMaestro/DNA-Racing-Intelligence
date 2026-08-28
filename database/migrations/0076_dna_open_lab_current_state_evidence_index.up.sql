BEGIN;

CREATE TABLE dna.dna_open_lab_current_state_evidence_index (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  plan_sha256 char(64) NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  indexed_at timestamptz NOT NULL,
  receipt_count integer NOT NULL CHECK (receipt_count BETWEEN 1 AND 512),
  receipt_index jsonb NOT NULL CHECK (jsonb_typeof(receipt_index) = 'object'),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, generation_id),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
    ON DELETE CASCADE,
  CHECK (recorded_at >= indexed_at)
);

ALTER TABLE dna.dna_open_lab_current_state_evidence_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_current_state_evidence_index FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_current_state_evidence_index
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.validate_dna_open_lab_current_state_evidence_index(
  p_generation_id uuid,
  p_index jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_receipt_count integer;
  v_indexed_at timestamptz;
  v_receipt jsonb;
  v_cycle_id uuid;
  v_observed_at timestamptz;
BEGIN
  IF jsonb_typeof(p_index) <> 'object' THEN
    RAISE EXCEPTION 'current-state evidence index must be an object';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_index);
  IF v_key_count <> 5 OR NOT (
    p_index ? 'version' AND p_index ? 'generationId'
    AND p_index ? 'planSha256' AND p_index ? 'indexedAt'
    AND p_index ? 'receipts'
  ) OR jsonb_typeof(p_index -> 'version') <> 'number'
    OR p_index ->> 'version' <> '1'
    OR jsonb_typeof(p_index -> 'generationId') <> 'string'
    OR p_index ->> 'generationId' <> p_generation_id::text
    OR jsonb_typeof(p_index -> 'planSha256') <> 'string'
    OR p_index ->> 'planSha256' !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_index -> 'indexedAt') <> 'string'
    OR jsonb_typeof(p_index -> 'receipts') <> 'array' THEN
    RAISE EXCEPTION 'current-state evidence index authority is invalid';
  END IF;
  BEGIN
    v_indexed_at := (p_index ->> 'indexedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'current-state evidence index timestamp is invalid';
  END;
  v_receipt_count := jsonb_array_length(p_index -> 'receipts');
  IF v_receipt_count NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'current-state evidence receipt count is invalid';
  END IF;

  FOR v_receipt IN SELECT value FROM jsonb_array_elements(p_index -> 'receipts')
  LOOP
    IF jsonb_typeof(v_receipt) <> 'object' THEN
      RAISE EXCEPTION 'current-state evidence receipt must be an object';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_receipt);
    IF v_key_count <> 6 OR NOT (
      v_receipt ? 'group' AND v_receipt ? 'requestKey'
      AND v_receipt ? 'cycleId' AND v_receipt ? 'observedAt'
      AND v_receipt ? 'contentSha256' AND v_receipt ? 'evidenceObjectKey'
    ) OR jsonb_typeof(v_receipt -> 'group') <> 'string'
      OR v_receipt ->> 'group' NOT IN (
        'race_activity', 'token_prices', 'vault_identity',
        'core_current_state', 'splice_arena'
      )
      OR jsonb_typeof(v_receipt -> 'requestKey') <> 'string'
      OR v_receipt ->> 'requestKey' !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(v_receipt -> 'cycleId') <> 'string'
      OR jsonb_typeof(v_receipt -> 'observedAt') <> 'string'
      OR jsonb_typeof(v_receipt -> 'contentSha256') <> 'string'
      OR v_receipt ->> 'contentSha256' !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(v_receipt -> 'evidenceObjectKey') <> 'string'
      OR length(v_receipt ->> 'evidenceObjectKey') NOT BETWEEN 1 AND 4096
      OR v_receipt ->> 'evidenceObjectKey' ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'current-state evidence receipt is invalid';
    END IF;
    BEGIN
      v_cycle_id := (v_receipt ->> 'cycleId')::uuid;
      v_observed_at := (v_receipt ->> 'observedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'current-state evidence receipt identity is invalid';
    END;
    IF v_cycle_id IS NULL OR v_observed_at > v_indexed_at THEN
      RAISE EXCEPTION 'current-state evidence receipt chronology is invalid';
    END IF;
  END LOOP;
  IF (
    SELECT count(DISTINCT value ->> 'requestKey')
    FROM jsonb_array_elements(p_index -> 'receipts')
  ) <> v_receipt_count THEN
    RAISE EXCEPTION 'current-state evidence receipt request keys repeat';
  END IF;
END
$function$;

CREATE FUNCTION dna.save_dna_open_lab_current_state_evidence_index(
  p_owner_id uuid,
  p_generation_id uuid,
  p_index jsonb,
  p_recorded_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_open_lab_current_state_evidence_index%ROWTYPE;
  v_generation dna.dna_open_lab_sync_generation%ROWTYPE;
  v_indexed_at timestamptz;
  v_receipt_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped current-state evidence index denied';
  END IF;
  PERFORM dna.validate_dna_open_lab_current_state_evidence_index(
    p_generation_id, p_index
  );
  v_indexed_at := (p_index ->> 'indexedAt')::timestamptz;
  IF p_recorded_at IS NULL OR p_recorded_at < v_indexed_at THEN
    RAISE EXCEPTION 'current-state evidence index recording timestamp is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':' || p_generation_id::text || ':dna-current-state-index', 0
  ));
  SELECT generation.* INTO v_generation
  FROM dna.dna_open_lab_sync_generation generation
  WHERE generation.owner_id = p_owner_id AND generation.id = p_generation_id
  FOR UPDATE;
  IF NOT FOUND OR v_generation.status NOT IN ('staged', 'published') THEN
    RAISE EXCEPTION 'current-state evidence index generation is not staged';
  END IF;
  v_receipt_count := jsonb_array_length(p_index -> 'receipts');
  SELECT stored.* INTO v_existing
  FROM dna.dna_open_lab_current_state_evidence_index stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.plan_sha256 <> p_index ->> 'planSha256'
       OR v_existing.indexed_at <> v_indexed_at
       OR v_existing.receipt_count <> v_receipt_count
       OR v_existing.receipt_index <> p_index
       OR v_existing.recorded_at <> p_recorded_at THEN
      RAISE EXCEPTION 'current-state evidence index replay conflict';
    END IF;
    RETURN v_generation.status;
  END IF;
  INSERT INTO dna.dna_open_lab_current_state_evidence_index (
    owner_id, generation_id, plan_sha256, indexed_at,
    receipt_count, receipt_index, recorded_at
  ) VALUES (
    p_owner_id, p_generation_id, p_index ->> 'planSha256', v_indexed_at,
    v_receipt_count, p_index, p_recorded_at
  );
  RETURN v_generation.status;
END
$function$;

CREATE FUNCTION dna.publish_dna_open_lab_indexed_sync_candidate(
  p_owner_id uuid,
  p_generation_id uuid,
  p_accepted_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped indexed publication denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dna.dna_open_lab_current_state_evidence_index stored
    WHERE stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id
  ) THEN
    RAISE EXCEPTION 'current-state evidence index is required before publication';
  END IF;
  RETURN dna.publish_dna_open_lab_sync_candidate(
    p_owner_id, p_generation_id, p_accepted_at
  );
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_serving_current_state_evidence_index(
  p_owner_id uuid
)
RETURNS TABLE (
  generation_id uuid,
  plan_sha256 text,
  indexed_at timestamptz,
  receipt_count integer,
  receipt_index jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped current-state evidence index read denied';
  END IF;
  RETURN QUERY
  SELECT stored.generation_id, stored.plan_sha256::text, stored.indexed_at,
    stored.receipt_count, stored.receipt_index
  FROM dna.dna_open_lab_sync_state state
  JOIN dna.dna_open_lab_current_state_evidence_index stored
    ON stored.owner_id = state.owner_id
   AND stored.generation_id = state.serving_generation_id
  WHERE state.owner_id = p_owner_id;
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_current_state_evidence_index FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.validate_dna_open_lab_current_state_evidence_index(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.save_dna_open_lab_current_state_evidence_index(uuid,uuid,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_dna_open_lab_indexed_sync_candidate(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_serving_current_state_evidence_index(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamptz) FROM dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.save_dna_open_lab_current_state_evidence_index(uuid,uuid,jsonb,timestamptz) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_dna_open_lab_indexed_sync_candidate(uuid,uuid,timestamptz) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_current_state_evidence_index(uuid) TO dna_app_runtime;

COMMIT;

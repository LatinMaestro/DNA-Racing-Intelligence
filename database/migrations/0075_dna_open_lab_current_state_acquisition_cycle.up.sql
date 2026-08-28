BEGIN;

CREATE TABLE dna.dna_open_lab_current_state_acquisition_cycle (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  cycle_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  checkpoint jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, cycle_id),
  CHECK (jsonb_typeof(checkpoint) = 'object')
);

ALTER TABLE dna.dna_open_lab_current_state_acquisition_cycle
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_current_state_acquisition_cycle
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_current_state_acquisition_cycle
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.validate_dna_open_lab_current_state_acquisition_cycle(
  p_cycle_id uuid,
  p_checkpoint jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_evaluated_at timestamptz;
  v_retry_not_before timestamptz;
  v_status text;
  v_pause_reason text;
  v_scheduled_count integer;
  v_receipt_count integer;
  v_item jsonb;
  v_position integer;
BEGIN
  IF jsonb_typeof(p_checkpoint) <> 'object' THEN
    RAISE EXCEPTION 'current-state acquisition checkpoint must be an object';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_checkpoint);
  IF v_key_count <> 10 OR NOT (
    p_checkpoint ? 'version' AND p_checkpoint ? 'cycleId'
    AND p_checkpoint ? 'evaluatedAt' AND p_checkpoint ? 'scheduleSha256'
    AND p_checkpoint ? 'status' AND p_checkpoint ? 'scheduledRequestKeys'
    AND p_checkpoint ? 'receipts' AND p_checkpoint ? 'completedGroups'
    AND p_checkpoint ? 'pauseReason' AND p_checkpoint ? 'retryNotBefore'
  ) THEN
    RAISE EXCEPTION 'current-state acquisition checkpoint fields are invalid';
  END IF;
  IF jsonb_typeof(p_checkpoint -> 'version') <> 'number'
     OR p_checkpoint ->> 'version' <> '1'
     OR jsonb_typeof(p_checkpoint -> 'cycleId') <> 'string'
     OR p_checkpoint ->> 'cycleId' <> p_cycle_id::text
     OR jsonb_typeof(p_checkpoint -> 'evaluatedAt') <> 'string'
     OR jsonb_typeof(p_checkpoint -> 'scheduleSha256') <> 'string'
     OR p_checkpoint ->> 'scheduleSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_checkpoint -> 'status') <> 'string' THEN
    RAISE EXCEPTION 'current-state acquisition checkpoint authority is invalid';
  END IF;
  BEGIN
    v_evaluated_at := (p_checkpoint ->> 'evaluatedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'current-state acquisition evaluation timestamp is invalid';
  END;
  v_status := p_checkpoint ->> 'status';
  IF v_status NOT IN ('running', 'paused', 'awaiting_evidence', 'ready_to_publish') THEN
    RAISE EXCEPTION 'current-state acquisition status is invalid';
  END IF;

  IF jsonb_typeof(p_checkpoint -> 'scheduledRequestKeys') <> 'array' THEN
    RAISE EXCEPTION 'current-state acquisition scheduled requests are invalid';
  END IF;
  v_scheduled_count := jsonb_array_length(p_checkpoint -> 'scheduledRequestKeys');
  IF v_scheduled_count > 512 OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_checkpoint -> 'scheduledRequestKeys') entry(value)
    WHERE jsonb_typeof(entry.value) <> 'string'
       OR entry.value #>> '{}' !~ '^[a-f0-9]{64}$'
  ) OR (
    SELECT count(DISTINCT entry.value)::integer
    FROM jsonb_array_elements_text(
      p_checkpoint -> 'scheduledRequestKeys'
    ) entry(value)
  ) <> v_scheduled_count THEN
    RAISE EXCEPTION 'current-state acquisition scheduled request coverage is invalid';
  END IF;

  IF jsonb_typeof(p_checkpoint -> 'receipts') <> 'array' THEN
    RAISE EXCEPTION 'current-state acquisition receipts are invalid';
  END IF;
  v_receipt_count := jsonb_array_length(p_checkpoint -> 'receipts');
  IF v_receipt_count > v_scheduled_count THEN
    RAISE EXCEPTION 'current-state acquisition receipt bound exceeded';
  END IF;
  FOR v_item, v_position IN
    SELECT entry.value, entry.ordinality::integer
    FROM jsonb_array_elements(p_checkpoint -> 'receipts') WITH ORDINALITY entry
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'current-state acquisition receipt must be an object';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_item);
    IF v_key_count <> 4 OR NOT (
      v_item ? 'requestKey' AND v_item ? 'observedAt'
      AND v_item ? 'contentSha256' AND v_item ? 'evidenceObjectKey'
    ) OR jsonb_typeof(v_item -> 'requestKey') <> 'string'
      OR jsonb_typeof(v_item -> 'observedAt') <> 'string'
      OR jsonb_typeof(v_item -> 'contentSha256') <> 'string'
      OR jsonb_typeof(v_item -> 'evidenceObjectKey') <> 'string'
      OR v_item ->> 'requestKey' !~ '^[a-f0-9]{64}$'
      OR v_item ->> 'contentSha256' !~ '^[a-f0-9]{64}$'
      OR length(v_item ->> 'evidenceObjectKey') NOT BETWEEN 1 AND 4096
      OR v_item ->> 'evidenceObjectKey' ~ '[[:cntrl:]]'
      OR v_item ->> 'requestKey' <>
        p_checkpoint -> 'scheduledRequestKeys' ->> (v_position - 1) THEN
      RAISE EXCEPTION 'current-state acquisition receipt is invalid';
    END IF;
    BEGIN
      IF (v_item ->> 'observedAt')::timestamptz < v_evaluated_at THEN
        RAISE EXCEPTION 'current-state acquisition receipt predates evaluation';
      END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'current-state acquisition receipt timestamp is invalid';
    END;
  END LOOP;

  IF jsonb_typeof(p_checkpoint -> 'completedGroups') <> 'array'
     OR jsonb_array_length(p_checkpoint -> 'completedGroups') > 5
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_checkpoint -> 'completedGroups') entry
       WHERE jsonb_typeof(entry.value) <> 'string'
          OR entry.value #>> '{}' NOT IN (
            'race_activity', 'token_prices', 'vault_identity',
            'core_current_state', 'splice_arena'
          )
     ) OR (
       SELECT count(DISTINCT entry.value #>> '{}')
       FROM jsonb_array_elements(p_checkpoint -> 'completedGroups') entry
     ) <> jsonb_array_length(p_checkpoint -> 'completedGroups')
     OR COALESCE((
       SELECT array_agg(rank ORDER BY entry.ordinality) <>
              array_agg(rank ORDER BY rank)
       FROM jsonb_array_elements(p_checkpoint -> 'completedGroups')
         WITH ORDINALITY entry(value, ordinality)
       CROSS JOIN LATERAL (VALUES (CASE entry.value #>> '{}'
         WHEN 'race_activity' THEN 1 WHEN 'token_prices' THEN 2
         WHEN 'vault_identity' THEN 3 WHEN 'core_current_state' THEN 4
         WHEN 'splice_arena' THEN 5 END)) ranked(rank)
     ), false) THEN
    RAISE EXCEPTION 'current-state acquisition completed groups are invalid';
  END IF;

  v_pause_reason := p_checkpoint ->> 'pauseReason';
  IF (v_status = 'paused') IS DISTINCT FROM (v_pause_reason IS NOT NULL)
     OR (v_pause_reason IS NOT NULL AND v_pause_reason NOT IN (
       'api_unavailable', 'api_ineligible', 'rate_limited', 'invalid_payload'
     )) THEN
    RAISE EXCEPTION 'current-state acquisition pause authority is invalid';
  END IF;
  IF jsonb_typeof(p_checkpoint -> 'retryNotBefore') = 'null' THEN
    v_retry_not_before := NULL;
  ELSIF jsonb_typeof(p_checkpoint -> 'retryNotBefore') = 'string' THEN
    BEGIN
      v_retry_not_before := (p_checkpoint ->> 'retryNotBefore')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'current-state acquisition retry timestamp is invalid';
    END;
  ELSE
    RAISE EXCEPTION 'current-state acquisition retry boundary is invalid';
  END IF;
  IF v_status <> 'paused' AND v_retry_not_before IS NOT NULL THEN
    RAISE EXCEPTION 'current-state acquisition retry boundary requires a pause';
  END IF;
  IF v_status IN ('awaiting_evidence', 'ready_to_publish')
     AND v_receipt_count <> v_scheduled_count THEN
    RAISE EXCEPTION 'current-state acquisition terminal state lacks receipts';
  END IF;
END
$function$;

CREATE FUNCTION dna.save_dna_open_lab_current_state_acquisition_cycle(
  p_owner_id uuid,
  p_cycle_id uuid,
  p_expected_revision bigint,
  p_checkpoint jsonb
)
RETURNS TABLE (revision bigint, checkpoint jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_open_lab_current_state_acquisition_cycle%ROWTYPE;
  v_old_receipt_count integer;
  v_new_receipt_count integer;
  v_next_revision bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped current-state acquisition cycle denied';
  END IF;
  IF p_expected_revision IS NOT NULL AND p_expected_revision < 1 THEN
    RAISE EXCEPTION 'current-state acquisition expected revision is invalid';
  END IF;
  PERFORM dna.validate_dna_open_lab_current_state_acquisition_cycle(
    p_cycle_id, p_checkpoint
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':' || p_cycle_id::text || ':dna-current-state-cycle', 0)
  );
  SELECT stored.* INTO v_existing
  FROM dna.dna_open_lab_current_state_acquisition_cycle stored
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = p_cycle_id
  FOR UPDATE;

  IF FOUND AND v_existing.checkpoint = p_checkpoint AND (
    v_existing.revision = p_expected_revision
    OR v_existing.revision = COALESCE(p_expected_revision, 0) + 1
  ) THEN
    RETURN QUERY SELECT v_existing.revision, v_existing.checkpoint;
    RETURN;
  END IF;
  IF FOUND AND (
    p_expected_revision IS NULL OR v_existing.revision <> p_expected_revision
  ) THEN
    RAISE EXCEPTION 'current-state acquisition cycle revision conflict';
  END IF;

  IF NOT FOUND THEN
    IF p_expected_revision IS NOT NULL
       OR p_checkpoint ->> 'status' <> 'running'
       OR jsonb_array_length(p_checkpoint -> 'receipts') <> 0
       OR p_checkpoint -> 'pauseReason' <> 'null'::jsonb
       OR p_checkpoint -> 'retryNotBefore' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'current-state acquisition initial cycle is invalid';
    END IF;
    INSERT INTO dna.dna_open_lab_current_state_acquisition_cycle (
      owner_id, cycle_id, revision, checkpoint
    ) VALUES (p_owner_id, p_cycle_id, 1, p_checkpoint);
    RETURN QUERY SELECT 1::bigint, p_checkpoint;
    RETURN;
  END IF;

  IF v_existing.checkpoint -> 'version' <> p_checkpoint -> 'version'
     OR v_existing.checkpoint -> 'cycleId' <> p_checkpoint -> 'cycleId'
     OR v_existing.checkpoint -> 'evaluatedAt' <> p_checkpoint -> 'evaluatedAt'
     OR v_existing.checkpoint -> 'scheduleSha256' <> p_checkpoint -> 'scheduleSha256'
     OR v_existing.checkpoint -> 'scheduledRequestKeys' <>
        p_checkpoint -> 'scheduledRequestKeys' THEN
    RAISE EXCEPTION 'current-state acquisition cycle authority cannot change';
  END IF;
  IF v_existing.checkpoint ->> 'status' IN ('awaiting_evidence', 'ready_to_publish') THEN
    RAISE EXCEPTION 'current-state acquisition terminal cycle cannot advance';
  END IF;

  v_old_receipt_count := jsonb_array_length(v_existing.checkpoint -> 'receipts');
  v_new_receipt_count := jsonb_array_length(p_checkpoint -> 'receipts');
  IF v_new_receipt_count NOT BETWEEN v_old_receipt_count AND v_old_receipt_count + 1
     OR (p_checkpoint -> 'receipts') - v_old_receipt_count <>
        v_existing.checkpoint -> 'receipts'
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(
         v_existing.checkpoint -> 'completedGroups'
       ) old_group
       WHERE NOT (p_checkpoint -> 'completedGroups') ? old_group
     ) THEN
    RAISE EXCEPTION 'current-state acquisition cycle progress is not append-only';
  END IF;
  IF v_new_receipt_count = v_old_receipt_count + 1
     AND p_checkpoint ->> 'status' <> 'running' THEN
    RAISE EXCEPTION 'current-state acquisition receipt advancement must remain running';
  END IF;
  IF v_existing.checkpoint ->> 'status' = 'paused'
     AND p_checkpoint ->> 'status' NOT IN ('paused', 'running') THEN
    RAISE EXCEPTION 'current-state acquisition paused cycle transition is invalid';
  END IF;

  v_next_revision := v_existing.revision + 1;
  UPDATE dna.dna_open_lab_current_state_acquisition_cycle stored
  SET revision = v_next_revision, checkpoint = p_checkpoint,
      updated_at = clock_timestamp()
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = p_cycle_id;
  RETURN QUERY SELECT v_next_revision, p_checkpoint;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_current_state_acquisition_cycle(
  p_owner_id uuid,
  p_cycle_id uuid
)
RETURNS TABLE (revision bigint, checkpoint jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped current-state acquisition cycle read denied';
  END IF;
  RETURN QUERY
  SELECT stored.revision, stored.checkpoint
  FROM dna.dna_open_lab_current_state_acquisition_cycle stored
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = p_cycle_id;
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_current_state_acquisition_cycle FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.validate_dna_open_lab_current_state_acquisition_cycle(
  uuid, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.save_dna_open_lab_current_state_acquisition_cycle(
  uuid, uuid, bigint, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_current_state_acquisition_cycle(
  uuid, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.save_dna_open_lab_current_state_acquisition_cycle(
  uuid, uuid, bigint, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_current_state_acquisition_cycle(
  uuid, uuid
) TO dna_app_runtime;

COMMIT;

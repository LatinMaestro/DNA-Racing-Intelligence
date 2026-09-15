BEGIN;

CREATE TABLE dna.dna_core_race_history_acquisition_cycle (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  cycle_id character(64) NOT NULL CHECK (cycle_id ~ '^[a-f0-9]{64}$'),
  source_family text NOT NULL CHECK (source_family = 'core_race_history'),
  previous_completed_cycle_id character(64),
  current_state_generation_id uuid NOT NULL,
  evaluated_at timestamptz NOT NULL,
  core_set_sha256 character(64) NOT NULL
    CHECK (core_set_sha256 ~ '^[a-f0-9]{64}$'),
  core_count integer NOT NULL CHECK (core_count BETWEEN 1 AND 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, cycle_id),
  UNIQUE (owner_id, current_state_generation_id),
  FOREIGN KEY (owner_id, previous_completed_cycle_id)
    REFERENCES dna.dna_core_race_history_acquisition_cycle(owner_id, cycle_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, current_state_generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
    ON DELETE RESTRICT,
  CHECK (
    previous_completed_cycle_id IS NULL
    OR previous_completed_cycle_id ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX dna_core_race_history_acquisition_root_uq
  ON dna.dna_core_race_history_acquisition_cycle (owner_id, source_family)
  WHERE previous_completed_cycle_id IS NULL;

CREATE UNIQUE INDEX dna_core_race_history_acquisition_successor_uq
  ON dna.dna_core_race_history_acquisition_cycle (
    owner_id, source_family, previous_completed_cycle_id
  )
  WHERE previous_completed_cycle_id IS NOT NULL;

CREATE TABLE dna.dna_core_race_history_acquisition_attempt (
  owner_id uuid NOT NULL,
  cycle_id character(64) NOT NULL,
  attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 32),
  attempt_id character(64) NOT NULL CHECK (attempt_id ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL
    CHECK (status IN ('running', 'paused', 'complete', 'superseded')),
  cycle jsonb NOT NULL CHECK (jsonb_typeof(cycle) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, cycle_id, attempt_number),
  UNIQUE (owner_id, attempt_id),
  FOREIGN KEY (owner_id, cycle_id)
    REFERENCES dna.dna_core_race_history_acquisition_cycle(owner_id, cycle_id)
    ON DELETE RESTRICT
);

CREATE TABLE dna.dna_core_race_history_core_checkpoint (
  owner_id uuid NOT NULL,
  cycle_id character(64) NOT NULL,
  attempt_number smallint NOT NULL,
  core_id bigint NOT NULL CHECK (core_id BETWEEN 1 AND 9007199254740991),
  core_ordinal integer NOT NULL CHECK (core_ordinal BETWEEN 1 AND 4096),
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('running', 'complete')),
  checkpoint jsonb NOT NULL CHECK (jsonb_typeof(checkpoint) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, cycle_id, attempt_number, core_id),
  UNIQUE (owner_id, cycle_id, attempt_number, core_ordinal),
  FOREIGN KEY (owner_id, cycle_id, attempt_number)
    REFERENCES dna.dna_core_race_history_acquisition_attempt(
      owner_id, cycle_id, attempt_number
    ) ON DELETE RESTRICT
);

CREATE TABLE dna.dna_core_race_history_page_receipt (
  owner_id uuid NOT NULL,
  cycle_id character(64) NOT NULL,
  attempt_number smallint NOT NULL,
  core_id bigint NOT NULL,
  page_number integer NOT NULL CHECK (page_number BETWEEN 1 AND 10000),
  receipt_sha256 character(64) NOT NULL
    CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL,
  source_row_count smallint NOT NULL CHECK (source_row_count BETWEEN 0 AND 50),
  accepted_result_count smallint NOT NULL CHECK (accepted_result_count BETWEEN 0 AND 50),
  quarantine_count smallint NOT NULL CHECK (quarantine_count BETWEEN 0 AND 50),
  replay_duplicate_count smallint NOT NULL CHECK (replay_duplicate_count BETWEEN 0 AND 50),
  terminal boolean NOT NULL,
  page_object_key text NOT NULL,
  page_body_sha256 character(64) NOT NULL
    CHECK (page_body_sha256 ~ '^[a-f0-9]{64}$'),
  page_byte_length integer NOT NULL CHECK (page_byte_length BETWEEN 1 AND 8388608),
  quarantine_object_key text,
  quarantine_body_sha256 character(64),
  quarantine_byte_length integer,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, cycle_id, attempt_number, core_id, page_number),
  UNIQUE (owner_id, page_object_key),
  UNIQUE (owner_id, quarantine_object_key),
  FOREIGN KEY (owner_id, cycle_id, attempt_number, core_id)
    REFERENCES dna.dna_core_race_history_core_checkpoint(
      owner_id, cycle_id, attempt_number, core_id
    ) ON DELETE RESTRICT,
  CHECK (length(page_object_key) BETWEEN 1 AND 4096),
  CHECK (page_object_key !~ '[[:cntrl:]]'),
  CHECK (
    accepted_result_count + quarantine_count + replay_duplicate_count
    = source_row_count
  ),
  CHECK (terminal = (source_row_count = 0)),
  CHECK (
    (quarantine_count = 0 AND quarantine_object_key IS NULL
      AND quarantine_body_sha256 IS NULL AND quarantine_byte_length IS NULL)
    OR
    (quarantine_count > 0 AND quarantine_object_key IS NOT NULL
      AND quarantine_body_sha256 IS NOT NULL
      AND quarantine_byte_length IS NOT NULL
      AND length(quarantine_object_key) BETWEEN 1 AND 4096
      AND quarantine_object_key !~ '[[:cntrl:]]'
      AND quarantine_body_sha256 ~ '^[a-f0-9]{64}$'
      AND quarantine_byte_length BETWEEN 1 AND 8388608)
  )
);

ALTER TABLE dna.dna_core_race_history_acquisition_cycle
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_core_race_history_acquisition_cycle
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_core_race_history_acquisition_cycle
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_core_race_history_acquisition_attempt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_core_race_history_acquisition_attempt
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_core_race_history_acquisition_attempt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_core_race_history_core_checkpoint
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_core_race_history_core_checkpoint
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_core_race_history_core_checkpoint
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_core_race_history_page_receipt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_core_race_history_page_receipt
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_core_race_history_page_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.validate_dna_core_race_history_acquisition_cycle(
  p_cycle jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_core_count integer;
  v_core jsonb;
  v_core_value numeric;
  v_previous_core numeric := 0;
  v_attempt integer;
  v_status text;
  v_evaluated_at timestamptz;
  v_pause jsonb;
  v_completion jsonb;
  v_counter_key text;
  v_counter numeric;
BEGIN
  IF jsonb_typeof(p_cycle) <> 'object' THEN
    RAISE EXCEPTION 'Core history acquisition cycle must be an object';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_cycle);
  IF v_key_count <> 14 OR NOT (p_cycle ?& ARRAY[
    'version', 'cycleId', 'attemptId', 'previousCompletedCycleId',
    'sourceFamily', 'currentStateGenerationId', 'evaluatedAt',
    'coreSetSha256', 'coreIds', 'attemptNumber', 'status', 'pause',
    'completion', 'supersededByAttemptNumber'
  ]) THEN
    RAISE EXCEPTION 'Core history acquisition cycle fields are invalid';
  END IF;
  IF jsonb_typeof(p_cycle -> 'version') <> 'number'
     OR p_cycle ->> 'version' <> '1'
     OR jsonb_typeof(p_cycle -> 'cycleId') <> 'string'
     OR p_cycle ->> 'cycleId' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_cycle -> 'attemptId') <> 'string'
     OR p_cycle ->> 'attemptId' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_cycle -> 'sourceFamily') <> 'string'
     OR p_cycle ->> 'sourceFamily' <> 'core_race_history'
     OR jsonb_typeof(p_cycle -> 'currentStateGenerationId') <> 'string'
     OR jsonb_typeof(p_cycle -> 'evaluatedAt') <> 'string'
     OR jsonb_typeof(p_cycle -> 'coreSetSha256') <> 'string'
     OR p_cycle ->> 'coreSetSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_cycle -> 'attemptNumber') <> 'number'
     OR p_cycle ->> 'attemptNumber' !~ '^[0-9]+$'
     OR jsonb_typeof(p_cycle -> 'status') <> 'string'
     OR NOT (
       jsonb_typeof(p_cycle -> 'previousCompletedCycleId') = 'null'
       OR (
         jsonb_typeof(p_cycle -> 'previousCompletedCycleId') = 'string'
         AND p_cycle ->> 'previousCompletedCycleId' ~ '^[a-f0-9]{64}$'
       )
     ) THEN
    RAISE EXCEPTION 'Core history acquisition authority is invalid';
  END IF;
  BEGIN
    PERFORM (p_cycle ->> 'currentStateGenerationId')::uuid;
    v_evaluated_at := (p_cycle ->> 'evaluatedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Core history acquisition generation or time is invalid';
  END;
  v_attempt := (p_cycle ->> 'attemptNumber')::integer;
  v_status := p_cycle ->> 'status';
  IF v_attempt NOT BETWEEN 1 AND 32
     OR v_status NOT IN ('running', 'paused', 'complete', 'superseded') THEN
    RAISE EXCEPTION 'Core history acquisition attempt or status is invalid';
  END IF;

  IF jsonb_typeof(p_cycle -> 'coreIds') <> 'array' THEN
    RAISE EXCEPTION 'Core history acquisition Core set is invalid';
  END IF;
  v_core_count := jsonb_array_length(p_cycle -> 'coreIds');
  IF v_core_count NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'Core history acquisition Core count is out of bounds';
  END IF;
  FOR v_core IN SELECT value FROM jsonb_array_elements(p_cycle -> 'coreIds')
  LOOP
    IF jsonb_typeof(v_core) <> 'number'
       OR v_core #>> '{}' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Core history acquisition Core identity is invalid';
    END IF;
    v_core_value := (v_core #>> '{}')::numeric;
    IF v_core_value NOT BETWEEN 1 AND 9007199254740991
       OR v_core_value <= v_previous_core THEN
      RAISE EXCEPTION 'Core history acquisition Core order is invalid';
    END IF;
    v_previous_core := v_core_value;
  END LOOP;

  v_pause := p_cycle -> 'pause';
  v_completion := p_cycle -> 'completion';
  IF v_status = 'running' THEN
    IF jsonb_typeof(v_pause) <> 'null'
       OR jsonb_typeof(v_completion) <> 'null'
       OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'null' THEN
      RAISE EXCEPTION 'running Core history acquisition metadata is invalid';
    END IF;
  ELSIF v_status = 'paused' THEN
    IF jsonb_typeof(v_pause) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_pause)) <> 3
       OR NOT (v_pause ?& ARRAY['reason', 'pausedAt', 'retryAt'])
       OR v_pause ->> 'reason' NOT IN (
         'api_unavailable', 'rate_limited', 'tier_ineligible',
         'budget_closed', 'invalid_response', 'evidence_conflict',
         'operator_hold'
       )
       OR jsonb_typeof(v_completion) <> 'null'
       OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'null' THEN
      RAISE EXCEPTION 'paused Core history acquisition metadata is invalid';
    END IF;
    BEGIN
      PERFORM (v_pause ->> 'pausedAt')::timestamptz;
      IF jsonb_typeof(v_pause -> 'retryAt') <> 'null'
         AND (v_pause ->> 'retryAt')::timestamptz <
           (v_pause ->> 'pausedAt')::timestamptz THEN
        RAISE EXCEPTION 'Core history acquisition retry precedes pause';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Core history acquisition pause time is invalid';
    END;
  ELSIF v_status = 'complete' THEN
    IF jsonb_typeof(v_pause) <> 'null'
       OR jsonb_typeof(v_completion) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_completion)) <> 9
       OR NOT (v_completion ?& ARRAY[
         'completedAt', 'completedCoreCount', 'pageReceiptCount',
         'sourceRowCount', 'acceptedResultCount', 'quarantineCount',
         'replayDuplicateCount', 'coreCompletionSetSha256', 'completionSha256'
       ])
       OR v_completion ->> 'coreCompletionSetSha256' !~ '^[a-f0-9]{64}$'
       OR v_completion ->> 'completionSha256' !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'null' THEN
      RAISE EXCEPTION 'complete Core history acquisition metadata is invalid';
    END IF;
    BEGIN
      IF (v_completion ->> 'completedAt')::timestamptz < v_evaluated_at THEN
        RAISE EXCEPTION 'Core history acquisition completion predates evaluation';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Core history acquisition completion time is invalid';
    END;
    FOREACH v_counter_key IN ARRAY ARRAY[
      'completedCoreCount', 'pageReceiptCount', 'sourceRowCount',
      'acceptedResultCount', 'quarantineCount', 'replayDuplicateCount'
    ] LOOP
      IF jsonb_typeof(v_completion -> v_counter_key) <> 'number'
         OR v_completion ->> v_counter_key !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Core history completion counter % is invalid', v_counter_key;
      END IF;
      v_counter := (v_completion ->> v_counter_key)::numeric;
      IF v_counter > 9007199254740991 THEN
        RAISE EXCEPTION 'Core history completion counter % is too large', v_counter_key;
      END IF;
    END LOOP;
    IF (v_completion ->> 'completedCoreCount')::integer <> v_core_count
       OR (v_completion ->> 'acceptedResultCount')::numeric
          + (v_completion ->> 'quarantineCount')::numeric
          + (v_completion ->> 'replayDuplicateCount')::numeric
          <> (v_completion ->> 'sourceRowCount')::numeric THEN
      RAISE EXCEPTION 'Core history acquisition completion counts disagree';
    END IF;
  ELSE
    IF jsonb_typeof(v_pause) <> 'null'
       OR jsonb_typeof(v_completion) <> 'null'
       OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'number'
       OR p_cycle ->> 'supersededByAttemptNumber' !~ '^[0-9]+$'
       OR (p_cycle ->> 'supersededByAttemptNumber')::integer <> v_attempt + 1
       OR v_attempt >= 32 THEN
      RAISE EXCEPTION 'superseded Core history acquisition metadata is invalid';
    END IF;
  END IF;
END
$function$;

CREATE FUNCTION dna.read_dna_core_race_history_acquisition_attempt(
  p_owner_id uuid,
  p_cycle_id text,
  p_attempt_number integer
)
RETURNS TABLE (revision bigint, cycle jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history acquisition read denied';
  END IF;
  IF p_cycle_id !~ '^[a-f0-9]{64}$'
     OR p_attempt_number NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'Core history acquisition read key is invalid';
  END IF;
  RETURN QUERY
  SELECT stored.revision, stored.cycle
  FROM dna.dna_core_race_history_acquisition_attempt stored
  WHERE stored.owner_id = p_owner_id
    AND stored.cycle_id = p_cycle_id::character(64)
    AND stored.attempt_number = p_attempt_number;
END
$function$;

CREATE FUNCTION dna.read_latest_complete_dna_core_race_history_acquisition(
  p_owner_id uuid
)
RETURNS TABLE (revision bigint, cycle jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped latest Core history acquisition read denied';
  END IF;
  RETURN QUERY
  SELECT stored.revision, stored.cycle
  FROM dna.dna_core_race_history_acquisition_attempt stored
  JOIN dna.dna_core_race_history_acquisition_cycle authority
    ON authority.owner_id = stored.owner_id AND authority.cycle_id = stored.cycle_id
  WHERE stored.owner_id = p_owner_id AND stored.status = 'complete'
  ORDER BY authority.evaluated_at DESC, stored.attempt_number DESC
  LIMIT 1;
END
$function$;

CREATE FUNCTION dna.read_next_dna_core_race_history_checkpoint(
  p_owner_id uuid,
  p_cycle_id text,
  p_attempt_number integer
)
RETURNS TABLE (revision bigint, checkpoint jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped next Core history checkpoint read denied';
  END IF;
  IF p_cycle_id !~ '^[a-f0-9]{64}$'
     OR p_attempt_number NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'next Core history checkpoint read key is invalid';
  END IF;
  RETURN QUERY
  SELECT stored.revision, stored.checkpoint
  FROM dna.dna_core_race_history_core_checkpoint stored
  JOIN dna.dna_core_race_history_acquisition_attempt attempt
    ON attempt.owner_id = stored.owner_id AND attempt.cycle_id = stored.cycle_id
   AND attempt.attempt_number = stored.attempt_number
  WHERE stored.owner_id = p_owner_id
    AND stored.cycle_id = p_cycle_id::character(64)
    AND stored.attempt_number = p_attempt_number
    AND stored.status = 'running' AND attempt.status = 'running'
  ORDER BY stored.core_ordinal
  LIMIT 1;
END
$function$;

CREATE FUNCTION dna.read_dna_core_race_history_checkpoints(
  p_owner_id uuid,
  p_cycle_id text,
  p_attempt_number integer
)
RETURNS TABLE (revision bigint, checkpoint jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history checkpoints read denied';
  END IF;
  IF p_cycle_id !~ '^[a-f0-9]{64}$'
     OR p_attempt_number NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'Core history checkpoints read key is invalid';
  END IF;
  RETURN QUERY
  SELECT stored.revision, stored.checkpoint
  FROM dna.dna_core_race_history_core_checkpoint stored
  WHERE stored.owner_id = p_owner_id
    AND stored.cycle_id = p_cycle_id::character(64)
    AND stored.attempt_number = p_attempt_number
  ORDER BY stored.core_ordinal;
END
$function$;

CREATE FUNCTION dna.save_dna_core_race_history_acquisition_attempt(
  p_owner_id uuid,
  p_expected_revision bigint,
  p_cycle jsonb
)
RETURNS TABLE (revision bigint, cycle jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_core_race_history_acquisition_attempt%ROWTYPE;
  v_authority dna.dna_core_race_history_acquisition_cycle%ROWTYPE;
  v_predecessor dna.dna_core_race_history_acquisition_attempt%ROWTYPE;
  v_generation dna.dna_open_lab_sync_generation%ROWTYPE;
  v_cycle_id character(64);
  v_attempt_id character(64);
  v_previous_cycle_id character(64);
  v_generation_id uuid;
  v_attempt smallint;
  v_status text;
  v_evaluated_at timestamptz;
  v_core_set_sha character(64);
  v_core_count integer;
  v_next_revision bigint;
  v_totals record;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history acquisition attempt denied';
  END IF;
  IF p_expected_revision IS NOT NULL AND p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Core history acquisition expected revision is invalid';
  END IF;
  PERFORM dna.validate_dna_core_race_history_acquisition_cycle(p_cycle);
  v_cycle_id := (p_cycle ->> 'cycleId')::character(64);
  v_attempt_id := (p_cycle ->> 'attemptId')::character(64);
  v_previous_cycle_id := NULLIF(
    p_cycle ->> 'previousCompletedCycleId', ''
  )::character(64);
  v_generation_id := (p_cycle ->> 'currentStateGenerationId')::uuid;
  v_attempt := (p_cycle ->> 'attemptNumber')::smallint;
  v_status := p_cycle ->> 'status';
  v_evaluated_at := (p_cycle ->> 'evaluatedAt')::timestamptz;
  v_core_set_sha := (p_cycle ->> 'coreSetSha256')::character(64);
  v_core_count := jsonb_array_length(p_cycle -> 'coreIds');

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':core-race-history:' || v_cycle_id::text, 0
  ));
  SELECT stored.* INTO v_existing
  FROM dna.dna_core_race_history_acquisition_attempt stored
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
    AND stored.attempt_number = v_attempt
  FOR UPDATE;

  IF FOUND THEN
    IF p_expected_revision IS NULL OR v_existing.revision <> p_expected_revision THEN
      IF v_existing.cycle = p_cycle
         AND v_existing.revision = COALESCE(p_expected_revision, 0) + 1 THEN
        RETURN QUERY SELECT v_existing.revision, v_existing.cycle;
        RETURN;
      END IF;
      RAISE EXCEPTION 'Core history acquisition revision conflict';
    END IF;
    IF v_existing.status IN ('complete', 'superseded') THEN
      RAISE EXCEPTION 'terminal Core history acquisition attempt cannot change';
    END IF;
    IF (v_existing.cycle - 'status' - 'pause' - 'completion'
        - 'supersededByAttemptNumber') <>
       (p_cycle - 'status' - 'pause' - 'completion'
        - 'supersededByAttemptNumber') THEN
      RAISE EXCEPTION 'Core history acquisition authority cannot change';
    END IF;
    IF v_existing.status = 'running'
       AND v_status NOT IN ('paused', 'complete', 'superseded') THEN
      RAISE EXCEPTION 'running Core history acquisition transition is invalid';
    END IF;
    IF v_existing.status = 'paused'
       AND v_status NOT IN ('running', 'superseded') THEN
      RAISE EXCEPTION 'paused Core history acquisition transition is invalid';
    END IF;
    IF v_status = 'complete' THEN
      SELECT
        count(*)::integer AS core_count,
        count(*) FILTER (WHERE status = 'complete')::integer AS complete_count,
        COALESCE(sum((checkpoint ->> 'completedPageCount')::numeric), 0) AS page_count,
        COALESCE(sum((checkpoint ->> 'sourceRowCount')::numeric), 0) AS source_count,
        COALESCE(sum((checkpoint ->> 'acceptedResultCount')::numeric), 0) AS accepted_count,
        COALESCE(sum((checkpoint ->> 'quarantineCount')::numeric), 0) AS quarantine_count,
        COALESCE(sum((checkpoint ->> 'replayDuplicateCount')::numeric), 0) AS replay_count
      INTO v_totals
      FROM dna.dna_core_race_history_core_checkpoint stored
      WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
        AND stored.attempt_number = v_attempt;
      IF v_totals.core_count <> v_core_count
         OR v_totals.complete_count <> v_core_count
         OR (p_cycle -> 'completion' ->> 'completedCoreCount')::numeric
            <> v_totals.complete_count
         OR (p_cycle -> 'completion' ->> 'pageReceiptCount')::numeric
            <> v_totals.page_count
         OR (p_cycle -> 'completion' ->> 'sourceRowCount')::numeric
            <> v_totals.source_count
         OR (p_cycle -> 'completion' ->> 'acceptedResultCount')::numeric
            <> v_totals.accepted_count
         OR (p_cycle -> 'completion' ->> 'quarantineCount')::numeric
            <> v_totals.quarantine_count
         OR (p_cycle -> 'completion' ->> 'replayDuplicateCount')::numeric
            <> v_totals.replay_count THEN
        RAISE EXCEPTION 'Core history acquisition completion coverage is incomplete';
      END IF;
    END IF;
    v_next_revision := v_existing.revision + 1;
    UPDATE dna.dna_core_race_history_acquisition_attempt stored
    SET revision = v_next_revision, status = v_status, cycle = p_cycle,
      attempt_id = v_attempt_id, updated_at = clock_timestamp()
    WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
      AND stored.attempt_number = v_attempt;
    RETURN QUERY SELECT v_next_revision, p_cycle;
    RETURN;
  END IF;

  IF p_expected_revision IS NOT NULL OR v_status <> 'running' THEN
    RAISE EXCEPTION 'initial Core history acquisition attempt is invalid';
  END IF;
  SELECT stored.* INTO v_authority
  FROM dna.dna_core_race_history_acquisition_cycle stored
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF v_attempt <> 1 THEN
      RAISE EXCEPTION 'Core history acquisition cycle must begin at attempt one';
    END IF;
    SELECT stored.* INTO v_generation
    FROM dna.dna_open_lab_sync_generation stored
    WHERE stored.owner_id = p_owner_id AND stored.id = v_generation_id
    FOR SHARE;
    IF NOT FOUND OR v_generation.status <> 'published'
       OR v_generation.observed_at > v_evaluated_at THEN
      RAISE EXCEPTION 'Core history ownership generation is unavailable';
    END IF;
    IF (
      SELECT count(*) FROM dna.dna_open_lab_owned_core_snapshot owned
      WHERE owned.owner_id = p_owner_id
        AND owned.generation_id = v_generation_id
    ) <> v_core_count OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(p_cycle -> 'coreIds') requested(value)
      LEFT JOIN dna.dna_open_lab_owned_core_snapshot owned
        ON owned.owner_id = p_owner_id
       AND owned.generation_id = v_generation_id
       AND owned.source_core_id = requested.value::bigint
      WHERE owned.source_core_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Core history cycle does not match owned Core authority';
    END IF;
    IF v_previous_cycle_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM dna.dna_core_race_history_acquisition_attempt previous_attempt
      JOIN dna.dna_core_race_history_acquisition_cycle previous_cycle
        ON previous_cycle.owner_id = previous_attempt.owner_id
       AND previous_cycle.cycle_id = previous_attempt.cycle_id
      WHERE previous_attempt.owner_id = p_owner_id
        AND previous_attempt.cycle_id = v_previous_cycle_id
        AND previous_attempt.status = 'complete'
        AND previous_cycle.evaluated_at <= v_evaluated_at
    ) THEN
      RAISE EXCEPTION 'previous completed Core history cycle is unavailable';
    END IF;
    INSERT INTO dna.dna_core_race_history_acquisition_cycle (
      owner_id, cycle_id, source_family, previous_completed_cycle_id,
      current_state_generation_id, evaluated_at, core_set_sha256, core_count
    ) VALUES (
      p_owner_id, v_cycle_id, 'core_race_history', v_previous_cycle_id,
      v_generation_id, v_evaluated_at, v_core_set_sha, v_core_count
    );
  ELSE
    IF v_attempt = 1
       OR v_authority.previous_completed_cycle_id IS DISTINCT FROM v_previous_cycle_id
       OR v_authority.current_state_generation_id <> v_generation_id
       OR v_authority.evaluated_at <> v_evaluated_at
       OR v_authority.core_set_sha256 <> v_core_set_sha
       OR v_authority.core_count <> v_core_count THEN
      RAISE EXCEPTION 'Core history acquisition cycle authority conflicts';
    END IF;
    SELECT stored.* INTO v_predecessor
    FROM dna.dna_core_race_history_acquisition_attempt stored
    WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
      AND stored.attempt_number = v_attempt - 1;
    IF NOT FOUND OR v_predecessor.status <> 'superseded'
       OR (v_predecessor.cycle ->> 'supersededByAttemptNumber')::integer <> v_attempt
       OR v_predecessor.cycle -> 'coreIds' <> p_cycle -> 'coreIds' THEN
      RAISE EXCEPTION 'Core history replacement attempt authority is invalid';
    END IF;
  END IF;

  INSERT INTO dna.dna_core_race_history_acquisition_attempt (
    owner_id, cycle_id, attempt_number, attempt_id, revision, status, cycle
  ) VALUES (
    p_owner_id, v_cycle_id, v_attempt, v_attempt_id, 1, 'running', p_cycle
  );
  INSERT INTO dna.dna_core_race_history_core_checkpoint (
    owner_id, cycle_id, attempt_number, core_id, core_ordinal,
    revision, status, checkpoint
  )
  SELECT
    p_owner_id, v_cycle_id, v_attempt, entry.value::bigint,
    entry.ordinality::integer, 1, 'running',
    jsonb_build_object(
      'version', 1, 'cycleId', v_cycle_id::text,
      'attemptNumber', v_attempt, 'coreId', entry.value::bigint,
      'coreOrdinal', entry.ordinality::integer, 'status', 'running',
      'nextPage', 1, 'completedPageCount', 0, 'sourceRowCount', 0,
      'acceptedResultCount', 0, 'quarantineCount', 0,
      'replayDuplicateCount', 0, 'receiptChainSha256', repeat('0', 64),
      'terminalPageNumber', null, 'completionSha256', null
    )
  FROM jsonb_array_elements_text(p_cycle -> 'coreIds')
    WITH ORDINALITY entry(value, ordinality);
  RETURN QUERY SELECT 1::bigint, p_cycle;
END
$function$;

CREATE FUNCTION dna.save_dna_core_race_history_page_progress(
  p_owner_id uuid,
  p_expected_core_revision bigint,
  p_checkpoint jsonb,
  p_receipt jsonb
)
RETURNS TABLE (revision bigint, checkpoint jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_attempt dna.dna_core_race_history_acquisition_attempt%ROWTYPE;
  v_existing dna.dna_core_race_history_core_checkpoint%ROWTYPE;
  v_existing_receipt dna.dna_core_race_history_page_receipt%ROWTYPE;
  v_cycle_id character(64);
  v_attempt_number smallint;
  v_core_id bigint;
  v_page integer;
  v_terminal boolean;
  v_next_revision bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history page progress denied';
  END IF;
  IF p_expected_core_revision IS NULL OR p_expected_core_revision < 1 THEN
    RAISE EXCEPTION 'Core history page progress revision is invalid';
  END IF;
  PERFORM dna.validate_dna_core_race_history_checkpoint(p_checkpoint);
  PERFORM dna.validate_dna_core_race_history_page_receipt(p_receipt);
  v_cycle_id := (p_checkpoint ->> 'cycleId')::character(64);
  v_attempt_number := (p_checkpoint ->> 'attemptNumber')::smallint;
  v_core_id := (p_checkpoint ->> 'coreId')::bigint;
  v_page := (p_receipt ->> 'pageNumber')::integer;
  v_terminal := (p_receipt ->> 'terminal')::boolean;
  IF p_receipt ->> 'cycleId' <> v_cycle_id::text
     OR (p_receipt ->> 'attemptNumber')::smallint <> v_attempt_number
     OR (p_receipt ->> 'coreId')::bigint <> v_core_id THEN
    RAISE EXCEPTION 'Core history page progress authority disagrees';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':core-race-history:' || v_cycle_id::text, 0
  ));
  SELECT stored.* INTO v_attempt
  FROM dna.dna_core_race_history_acquisition_attempt stored
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
    AND stored.attempt_number = v_attempt_number
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.status <> 'running' THEN
    RAISE EXCEPTION 'Core history page progress attempt is unavailable';
  END IF;
  SELECT stored.* INTO v_existing
  FROM dna.dna_core_race_history_core_checkpoint stored
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
    AND stored.attempt_number = v_attempt_number AND stored.core_id = v_core_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Core history page checkpoint is unavailable';
  END IF;

  IF v_existing.revision <> p_expected_core_revision THEN
    IF v_existing.revision = p_expected_core_revision + 1
       AND v_existing.checkpoint = p_checkpoint THEN
      SELECT stored.* INTO v_existing_receipt
      FROM dna.dna_core_race_history_page_receipt stored
      WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
        AND stored.attempt_number = v_attempt_number
        AND stored.core_id = v_core_id AND stored.page_number = v_page;
      IF FOUND AND v_existing_receipt.receipt = p_receipt THEN
        RETURN QUERY SELECT v_existing.revision, v_existing.checkpoint;
        RETURN;
      END IF;
      RAISE EXCEPTION 'Core history page progress replay conflicts';
    END IF;
    RAISE EXCEPTION 'Core history page progress revision conflict';
  END IF;
  IF v_existing.status <> 'running'
     OR v_page <> (v_existing.checkpoint ->> 'nextPage')::integer
     OR p_checkpoint ->> 'version' <> v_existing.checkpoint ->> 'version'
     OR p_checkpoint ->> 'cycleId' <> v_existing.checkpoint ->> 'cycleId'
     OR p_checkpoint ->> 'attemptNumber' <> v_existing.checkpoint ->> 'attemptNumber'
     OR p_checkpoint ->> 'coreId' <> v_existing.checkpoint ->> 'coreId'
     OR p_checkpoint ->> 'coreOrdinal' <> v_existing.checkpoint ->> 'coreOrdinal'
     OR (p_checkpoint ->> 'nextPage')::integer <> v_page + 1
     OR (p_checkpoint ->> 'completedPageCount')::integer <>
        (v_existing.checkpoint ->> 'completedPageCount')::integer + 1
     OR (p_checkpoint ->> 'sourceRowCount')::numeric <>
        (v_existing.checkpoint ->> 'sourceRowCount')::numeric
          + (p_receipt ->> 'sourceRowCount')::numeric
     OR (p_checkpoint ->> 'acceptedResultCount')::numeric <>
        (v_existing.checkpoint ->> 'acceptedResultCount')::numeric
          + (p_receipt ->> 'acceptedResultCount')::numeric
     OR (p_checkpoint ->> 'quarantineCount')::numeric <>
        (v_existing.checkpoint ->> 'quarantineCount')::numeric
          + (p_receipt ->> 'quarantineCount')::numeric
     OR (p_checkpoint ->> 'replayDuplicateCount')::numeric <>
        (v_existing.checkpoint ->> 'replayDuplicateCount')::numeric
          + (p_receipt ->> 'replayDuplicateCount')::numeric
     OR p_checkpoint ->> 'receiptChainSha256' =
        v_existing.checkpoint ->> 'receiptChainSha256'
     OR (v_terminal AND (
       p_checkpoint ->> 'status' <> 'complete'
       OR (p_checkpoint ->> 'terminalPageNumber')::integer <> v_page
       OR p_checkpoint ->> 'completionSha256' !~ '^[a-f0-9]{64}$'
     ))
     OR (NOT v_terminal AND (
       p_checkpoint ->> 'status' <> 'running'
       OR jsonb_typeof(p_checkpoint -> 'terminalPageNumber') <> 'null'
       OR jsonb_typeof(p_checkpoint -> 'completionSha256') <> 'null'
     )) THEN
    RAISE EXCEPTION 'Core history page progress transition is invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM dna.dna_core_race_history_page_receipt stored
    WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
      AND stored.attempt_number = v_attempt_number
      AND stored.core_id = v_core_id AND stored.page_number = v_page
  ) THEN
    RAISE EXCEPTION 'Core history page receipt already exists';
  END IF;

  INSERT INTO dna.dna_core_race_history_page_receipt (
    owner_id, cycle_id, attempt_number, core_id, page_number,
    receipt_sha256, observed_at, source_row_count, accepted_result_count,
    quarantine_count, replay_duplicate_count, terminal, page_object_key,
    page_body_sha256, page_byte_length, quarantine_object_key,
    quarantine_body_sha256, quarantine_byte_length, receipt
  ) VALUES (
    p_owner_id, v_cycle_id, v_attempt_number, v_core_id, v_page,
    (p_receipt ->> 'receiptSha256')::character(64),
    (p_receipt ->> 'observedAt')::timestamptz,
    (p_receipt ->> 'sourceRowCount')::smallint,
    (p_receipt ->> 'acceptedResultCount')::smallint,
    (p_receipt ->> 'quarantineCount')::smallint,
    (p_receipt ->> 'replayDuplicateCount')::smallint, v_terminal,
    p_receipt ->> 'pageObjectKey',
    (p_receipt ->> 'pageBodySha256')::character(64),
    (p_receipt ->> 'pageByteLength')::integer,
    p_receipt ->> 'quarantineObjectKey',
    NULLIF(p_receipt ->> 'quarantineBodySha256', '')::character(64),
    NULLIF(p_receipt ->> 'quarantineByteLength', '')::integer,
    p_receipt
  );
  v_next_revision := v_existing.revision + 1;
  UPDATE dna.dna_core_race_history_core_checkpoint stored
  SET revision = v_next_revision, status = p_checkpoint ->> 'status',
    checkpoint = p_checkpoint, updated_at = clock_timestamp()
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
    AND stored.attempt_number = v_attempt_number AND stored.core_id = v_core_id;
  RETURN QUERY SELECT v_next_revision, p_checkpoint;
END
$function$;

CREATE FUNCTION dna.validate_dna_core_race_history_checkpoint(
  p_checkpoint jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_status text;
  v_next_page integer;
  v_page_count integer;
  v_source numeric;
  v_accepted numeric;
  v_quarantine numeric;
  v_replay numeric;
  v_key text;
BEGIN
  IF jsonb_typeof(p_checkpoint) <> 'object' THEN
    RAISE EXCEPTION 'Core history checkpoint must be an object';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_checkpoint);
  IF v_key_count <> 15 OR NOT (p_checkpoint ?& ARRAY[
    'version', 'cycleId', 'attemptNumber', 'coreId', 'coreOrdinal',
    'status', 'nextPage', 'completedPageCount', 'sourceRowCount',
    'acceptedResultCount', 'quarantineCount', 'replayDuplicateCount',
    'receiptChainSha256', 'terminalPageNumber', 'completionSha256'
  ]) THEN
    RAISE EXCEPTION 'Core history checkpoint fields are invalid';
  END IF;
  IF p_checkpoint ->> 'version' <> '1'
     OR p_checkpoint ->> 'cycleId' !~ '^[a-f0-9]{64}$'
     OR p_checkpoint ->> 'receiptChainSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_checkpoint -> 'status') <> 'string' THEN
    RAISE EXCEPTION 'Core history checkpoint identity is invalid';
  END IF;
  FOREACH v_key IN ARRAY ARRAY[
    'attemptNumber', 'coreId', 'coreOrdinal', 'nextPage',
    'completedPageCount', 'sourceRowCount', 'acceptedResultCount',
    'quarantineCount', 'replayDuplicateCount'
  ] LOOP
    IF jsonb_typeof(p_checkpoint -> v_key) <> 'number'
       OR p_checkpoint ->> v_key !~ '^[0-9]+$'
       OR (p_checkpoint ->> v_key)::numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'Core history checkpoint counter % is invalid', v_key;
    END IF;
  END LOOP;
  IF (p_checkpoint ->> 'attemptNumber')::integer NOT BETWEEN 1 AND 32
     OR (p_checkpoint ->> 'coreId')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR (p_checkpoint ->> 'coreOrdinal')::integer NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'Core history checkpoint cursor authority is invalid';
  END IF;
  v_next_page := (p_checkpoint ->> 'nextPage')::integer;
  v_page_count := (p_checkpoint ->> 'completedPageCount')::integer;
  IF v_page_count NOT BETWEEN 0 AND 10000
     OR v_next_page <> v_page_count + 1
     OR v_next_page NOT BETWEEN 1 AND 10001 THEN
    RAISE EXCEPTION 'Core history checkpoint page cursor is invalid';
  END IF;
  v_source := (p_checkpoint ->> 'sourceRowCount')::numeric;
  v_accepted := (p_checkpoint ->> 'acceptedResultCount')::numeric;
  v_quarantine := (p_checkpoint ->> 'quarantineCount')::numeric;
  v_replay := (p_checkpoint ->> 'replayDuplicateCount')::numeric;
  IF v_accepted + v_quarantine + v_replay <> v_source THEN
    RAISE EXCEPTION 'Core history checkpoint row counts disagree';
  END IF;
  v_status := p_checkpoint ->> 'status';
  IF v_status = 'running' THEN
    IF jsonb_typeof(p_checkpoint -> 'terminalPageNumber') <> 'null'
       OR jsonb_typeof(p_checkpoint -> 'completionSha256') <> 'null' THEN
      RAISE EXCEPTION 'running Core history checkpoint metadata is invalid';
    END IF;
  ELSIF v_status = 'complete' THEN
    IF jsonb_typeof(p_checkpoint -> 'terminalPageNumber') <> 'number'
       OR p_checkpoint ->> 'terminalPageNumber' !~ '^[0-9]+$'
       OR (p_checkpoint ->> 'terminalPageNumber')::integer <> v_page_count
       OR p_checkpoint ->> 'completionSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'complete Core history checkpoint metadata is invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'Core history checkpoint status is invalid';
  END IF;
  IF v_page_count = 0
     AND p_checkpoint ->> 'receiptChainSha256' <> repeat('0', 64) THEN
    RAISE EXCEPTION 'initial Core history receipt chain is invalid';
  END IF;
END
$function$;

CREATE FUNCTION dna.validate_dna_core_race_history_page_receipt(
  p_receipt jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_source integer;
  v_accepted integer;
  v_quarantine integer;
  v_replay integer;
  v_attempt integer;
  v_page integer;
  v_cycle text;
  v_page_pattern text;
  v_quarantine_pattern text;
  v_key text;
BEGIN
  IF jsonb_typeof(p_receipt) <> 'object' THEN
    RAISE EXCEPTION 'Core history page receipt must be an object';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_receipt);
  IF v_key_count <> 18 OR NOT (p_receipt ?& ARRAY[
    'version', 'cycleId', 'attemptNumber', 'coreId', 'pageNumber',
    'observedAt', 'sourceRowCount', 'acceptedResultCount', 'quarantineCount',
    'replayDuplicateCount', 'terminal', 'pageObjectKey', 'pageBodySha256',
    'pageByteLength', 'quarantineObjectKey', 'quarantineBodySha256',
    'quarantineByteLength', 'receiptSha256'
  ]) THEN
    RAISE EXCEPTION 'Core history page receipt fields are invalid';
  END IF;
  IF p_receipt ->> 'version' <> '1'
     OR p_receipt ->> 'cycleId' !~ '^[a-f0-9]{64}$'
     OR p_receipt ->> 'pageBodySha256' !~ '^[a-f0-9]{64}$'
     OR p_receipt ->> 'receiptSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_receipt -> 'terminal') <> 'boolean' THEN
    RAISE EXCEPTION 'Core history page receipt identity is invalid';
  END IF;
  FOREACH v_key IN ARRAY ARRAY[
    'attemptNumber', 'coreId', 'pageNumber', 'sourceRowCount',
    'acceptedResultCount', 'quarantineCount', 'replayDuplicateCount',
    'pageByteLength'
  ] LOOP
    IF jsonb_typeof(p_receipt -> v_key) <> 'number'
       OR p_receipt ->> v_key !~ '^[0-9]+$'
       OR (p_receipt ->> v_key)::numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'Core history page receipt counter % is invalid', v_key;
    END IF;
  END LOOP;
  v_cycle := p_receipt ->> 'cycleId';
  v_attempt := (p_receipt ->> 'attemptNumber')::integer;
  v_page := (p_receipt ->> 'pageNumber')::integer;
  v_source := (p_receipt ->> 'sourceRowCount')::integer;
  v_accepted := (p_receipt ->> 'acceptedResultCount')::integer;
  v_quarantine := (p_receipt ->> 'quarantineCount')::integer;
  v_replay := (p_receipt ->> 'replayDuplicateCount')::integer;
  IF v_attempt NOT BETWEEN 1 AND 32
     OR (p_receipt ->> 'coreId')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR v_page NOT BETWEEN 1 AND 10000
     OR v_source NOT BETWEEN 0 AND 50
     OR v_accepted NOT BETWEEN 0 AND 50
     OR v_quarantine NOT BETWEEN 0 AND 50
     OR v_replay NOT BETWEEN 0 AND 50
     OR v_accepted + v_quarantine + v_replay <> v_source
     OR (p_receipt ->> 'pageByteLength')::integer NOT BETWEEN 1 AND 8388608
     OR (p_receipt ->> 'terminal')::boolean <> (v_source = 0) THEN
    RAISE EXCEPTION 'Core history page receipt values are invalid';
  END IF;
  BEGIN
    PERFORM (p_receipt ->> 'observedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Core history page receipt observation time is invalid';
  END;
  v_page_pattern := '^dna-open-lab/v1/[a-f0-9]{64}/core-race-history/cycles/'
    || v_cycle || '/attempts/' || v_attempt
    || '/cores/[a-f0-9]{64}/pages/' || v_page || '\.json$';
  v_quarantine_pattern := '^dna-open-lab/v1/[a-f0-9]{64}/core-race-history/cycles/'
    || v_cycle || '/attempts/' || v_attempt
    || '/cores/[a-f0-9]{64}/pages/' || v_page || '\.quarantine\.json$';
  IF jsonb_typeof(p_receipt -> 'pageObjectKey') <> 'string'
     OR length(p_receipt ->> 'pageObjectKey') NOT BETWEEN 1 AND 4096
     OR p_receipt ->> 'pageObjectKey' ~ '[[:cntrl:]]'
     OR p_receipt ->> 'pageObjectKey' !~ v_page_pattern THEN
    RAISE EXCEPTION 'Core history page object key is invalid';
  END IF;
  IF v_quarantine = 0 THEN
    IF jsonb_typeof(p_receipt -> 'quarantineObjectKey') <> 'null'
       OR jsonb_typeof(p_receipt -> 'quarantineBodySha256') <> 'null'
       OR jsonb_typeof(p_receipt -> 'quarantineByteLength') <> 'null' THEN
      RAISE EXCEPTION 'Core history empty quarantine receipt is invalid';
    END IF;
  ELSE
    IF jsonb_typeof(p_receipt -> 'quarantineObjectKey') <> 'string'
       OR p_receipt ->> 'quarantineObjectKey' !~ v_quarantine_pattern
       OR length(p_receipt ->> 'quarantineObjectKey') NOT BETWEEN 1 AND 4096
       OR p_receipt ->> 'quarantineObjectKey' ~ '[[:cntrl:]]'
       OR p_receipt ->> 'quarantineBodySha256' !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(p_receipt -> 'quarantineByteLength') <> 'number'
       OR p_receipt ->> 'quarantineByteLength' !~ '^[0-9]+$'
       OR (p_receipt ->> 'quarantineByteLength')::integer NOT BETWEEN 1 AND 8388608 THEN
      RAISE EXCEPTION 'Core history quarantine receipt is invalid';
    END IF;
  END IF;
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_core_race_history_acquisition_cycle,
  dna.dna_core_race_history_acquisition_attempt,
  dna.dna_core_race_history_core_checkpoint,
  dna.dna_core_race_history_page_receipt
FROM PUBLIC;
REVOKE ALL ON TABLE
  dna.dna_core_race_history_acquisition_cycle,
  dna.dna_core_race_history_acquisition_attempt,
  dna.dna_core_race_history_core_checkpoint,
  dna.dna_core_race_history_page_receipt
FROM dna_app_runtime;
REVOKE ALL ON FUNCTION
  dna.validate_dna_core_race_history_acquisition_cycle(jsonb),
  dna.validate_dna_core_race_history_checkpoint(jsonb),
  dna.validate_dna_core_race_history_page_receipt(jsonb),
  dna.save_dna_core_race_history_acquisition_attempt(uuid,bigint,jsonb),
  dna.save_dna_core_race_history_page_progress(uuid,bigint,jsonb,jsonb),
  dna.read_dna_core_race_history_acquisition_attempt(uuid,text,integer),
  dna.read_latest_complete_dna_core_race_history_acquisition(uuid),
  dna.read_next_dna_core_race_history_checkpoint(uuid,text,integer),
  dna.read_dna_core_race_history_checkpoints(uuid,text,integer)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  dna.save_dna_core_race_history_acquisition_attempt(uuid,bigint,jsonb),
  dna.save_dna_core_race_history_page_progress(uuid,bigint,jsonb,jsonb),
  dna.read_dna_core_race_history_acquisition_attempt(uuid,text,integer),
  dna.read_latest_complete_dna_core_race_history_acquisition(uuid),
  dna.read_next_dna_core_race_history_checkpoint(uuid,text,integer),
  dna.read_dna_core_race_history_checkpoints(uuid,text,integer)
TO dna_app_runtime;

COMMIT;

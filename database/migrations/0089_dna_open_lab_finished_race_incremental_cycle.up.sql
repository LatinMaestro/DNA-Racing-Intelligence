BEGIN;

CREATE TABLE dna.dna_open_lab_finished_race_incremental_cycle (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  cycle_id character(64) NOT NULL CHECK (cycle_id ~ '^[a-f0-9]{64}$'),
  source_family text NOT NULL CHECK (source_family = 'races_finished'),
  previous_completed_cycle_id character(64),
  lower_bound_at timestamptz NOT NULL,
  upper_bound_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, cycle_id),
  FOREIGN KEY (owner_id, previous_completed_cycle_id)
    REFERENCES dna.dna_open_lab_finished_race_incremental_cycle(owner_id, cycle_id)
    ON DELETE RESTRICT,
  CHECK (
    previous_completed_cycle_id IS NULL
    OR previous_completed_cycle_id ~ '^[a-f0-9]{64}$'
  ),
  CHECK (lower_bound_at < upper_bound_at)
);

CREATE UNIQUE INDEX dna_open_lab_finished_race_incremental_cycle_window_uq
  ON dna.dna_open_lab_finished_race_incremental_cycle (
    owner_id, source_family, lower_bound_at, upper_bound_at,
    COALESCE(previous_completed_cycle_id, repeat('0', 64)::character(64))
  );

CREATE UNIQUE INDEX dna_open_lab_finished_race_incremental_cycle_root_uq
  ON dna.dna_open_lab_finished_race_incremental_cycle (owner_id, source_family)
  WHERE previous_completed_cycle_id IS NULL;

CREATE UNIQUE INDEX dna_open_lab_finished_race_incremental_cycle_successor_uq
  ON dna.dna_open_lab_finished_race_incremental_cycle (
    owner_id, source_family, previous_completed_cycle_id
  )
  WHERE previous_completed_cycle_id IS NOT NULL;

CREATE TABLE dna.dna_open_lab_finished_race_incremental_attempt (
  owner_id uuid NOT NULL,
  cycle_id character(64) NOT NULL,
  attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 32),
  attempt_id character(64) NOT NULL CHECK (attempt_id ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('running', 'paused', 'complete', 'superseded')),
  cycle jsonb NOT NULL CHECK (jsonb_typeof(cycle) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, cycle_id, attempt_number),
  UNIQUE (owner_id, attempt_id),
  FOREIGN KEY (owner_id, cycle_id)
    REFERENCES dna.dna_open_lab_finished_race_incremental_cycle(owner_id, cycle_id)
    ON DELETE RESTRICT
);

ALTER TABLE dna.dna_open_lab_finished_race_incremental_cycle
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_finished_race_incremental_cycle
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_finished_race_incremental_cycle
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_finished_race_incremental_attempt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_finished_race_incremental_attempt
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_finished_race_incremental_attempt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.validate_dna_open_lab_finished_race_incremental_cycle(
  p_cycle jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_checkpoint jsonb;
  v_root jsonb;
  v_lower timestamptz;
  v_upper timestamptz;
  v_pause jsonb;
  v_completion jsonb;
  v_numeric_key text;
  v_numeric_value numeric;
BEGIN
  IF jsonb_typeof(p_cycle) <> 'object' THEN
    RAISE EXCEPTION 'finished-race incremental cycle must be an object';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_cycle);
  IF v_key_count <> 13 OR NOT (p_cycle ?& ARRAY[
    'version', 'cycleId', 'attemptId', 'previousCompletedCycleId',
    'sourceFamily', 'lowerBoundAt', 'upperBoundAt', 'attemptNumber',
    'status', 'checkpoint', 'pause', 'completion',
    'supersededByAttemptNumber'
  ]) THEN
    RAISE EXCEPTION 'finished-race incremental cycle fields are invalid';
  END IF;
  IF jsonb_typeof(p_cycle -> 'version') <> 'number'
     OR p_cycle ->> 'version' <> '1'
     OR jsonb_typeof(p_cycle -> 'cycleId') <> 'string'
     OR p_cycle ->> 'cycleId' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_cycle -> 'attemptId') <> 'string'
     OR p_cycle ->> 'attemptId' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_cycle -> 'sourceFamily') <> 'string'
     OR p_cycle ->> 'sourceFamily' <> 'races_finished'
     OR jsonb_typeof(p_cycle -> 'attemptNumber') <> 'number'
     OR p_cycle ->> 'attemptNumber' !~ '^[0-9]+$'
     OR (p_cycle ->> 'attemptNumber')::integer NOT BETWEEN 1 AND 32
     OR jsonb_typeof(p_cycle -> 'status') <> 'string'
     OR p_cycle ->> 'status' NOT IN ('running', 'paused', 'complete', 'superseded')
     OR NOT (
       jsonb_typeof(p_cycle -> 'previousCompletedCycleId') = 'null'
       OR (
         jsonb_typeof(p_cycle -> 'previousCompletedCycleId') = 'string'
         AND p_cycle ->> 'previousCompletedCycleId' ~ '^[a-f0-9]{64}$'
       )
     ) THEN
    RAISE EXCEPTION 'finished-race incremental cycle identity is invalid';
  END IF;
  BEGIN
    v_lower := (p_cycle ->> 'lowerBoundAt')::timestamptz;
    v_upper := (p_cycle ->> 'upperBoundAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'finished-race incremental cycle bounds are invalid';
  END;
  IF v_lower >= v_upper THEN
    RAISE EXCEPTION 'finished-race incremental cycle chronology is invalid';
  END IF;

  v_checkpoint := p_cycle -> 'checkpoint';
  IF jsonb_typeof(v_checkpoint) <> 'object'
     OR NOT (v_checkpoint ?& ARRAY[
       'version', 'rootWindow', 'pendingWindows', 'minimumWindowMilliseconds',
       'completedWindowCount', 'splitCount',
       'successfulFinishedRaceRequestCount', 'raceDocumentRequestCount',
       'publishedWindowDocumentCount', 'identityOmissionAuthority',
       'omittedIdentityObservationCount'
     ])
     OR (SELECT count(*) FROM jsonb_object_keys(v_checkpoint)) <> 11
     OR v_checkpoint ->> 'version' <> '1'
     OR jsonb_typeof(v_checkpoint -> 'rootWindow') <> 'object'
     OR jsonb_typeof(v_checkpoint -> 'pendingWindows') <> 'array'
     OR jsonb_array_length(v_checkpoint -> 'pendingWindows') > 128
     OR jsonb_typeof(v_checkpoint -> 'identityOmissionAuthority') <> 'null'
     OR v_checkpoint ->> 'omittedIdentityObservationCount' <> '0' THEN
    RAISE EXCEPTION 'finished-race incremental checkpoint is invalid';
  END IF;
  v_root := v_checkpoint -> 'rootWindow';
  BEGIN
    IF (v_root ->> 'startTime')::timestamptz <> v_lower
       OR (v_root ->> 'endTime')::timestamptz <> v_upper THEN
      RAISE EXCEPTION 'finished-race incremental checkpoint root drifted';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'finished-race incremental checkpoint root is invalid';
  END;
  FOREACH v_numeric_key IN ARRAY ARRAY[
    'minimumWindowMilliseconds', 'completedWindowCount', 'splitCount',
    'successfulFinishedRaceRequestCount', 'raceDocumentRequestCount',
    'publishedWindowDocumentCount', 'omittedIdentityObservationCount'
  ] LOOP
    IF jsonb_typeof(v_checkpoint -> v_numeric_key) <> 'number'
       OR v_checkpoint ->> v_numeric_key !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'finished-race incremental counter % is invalid', v_numeric_key;
    END IF;
    v_numeric_value := (v_checkpoint ->> v_numeric_key)::numeric;
    IF v_numeric_value > 9007199254740991
       OR (v_numeric_key = 'minimumWindowMilliseconds' AND v_numeric_value < 1) THEN
      RAISE EXCEPTION 'finished-race incremental counter % is out of bounds', v_numeric_key;
    END IF;
  END LOOP;

  v_pause := p_cycle -> 'pause';
  v_completion := p_cycle -> 'completion';
  IF p_cycle ->> 'status' = 'running' THEN
    IF jsonb_typeof(v_pause) <> 'null'
       OR jsonb_typeof(v_completion) <> 'null'
       OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'null' THEN
      RAISE EXCEPTION 'running incremental cycle metadata is invalid';
    END IF;
  ELSIF p_cycle ->> 'status' = 'paused' THEN
    IF jsonb_typeof(v_pause) <> 'object'
       OR NOT (v_pause ?& ARRAY['reason', 'pausedAt', 'retryAt'])
       OR (SELECT count(*) FROM jsonb_object_keys(v_pause)) <> 3
       OR v_pause ->> 'reason' NOT IN (
         'api_unavailable', 'rate_limited', 'tier_ineligible',
         'budget_closed', 'invalid_response', 'operator_hold'
       )
       OR jsonb_typeof(v_completion) <> 'null'
       OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'null' THEN
      RAISE EXCEPTION 'paused incremental cycle metadata is invalid';
    END IF;
    BEGIN
      IF jsonb_typeof(v_pause -> 'retryAt') <> 'null'
         AND (v_pause ->> 'retryAt')::timestamptz <
             (v_pause ->> 'pausedAt')::timestamptz THEN
        RAISE EXCEPTION 'incremental retry precedes pause';
      END IF;
      PERFORM (v_pause ->> 'pausedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'incremental pause timestamps are invalid';
    END;
  ELSIF p_cycle ->> 'status' = 'complete' THEN
    IF jsonb_typeof(v_pause) <> 'null'
       OR jsonb_typeof(v_completion) <> 'object'
       OR NOT (v_completion ?& ARRAY[
         'completedAt', 'checkpointSha256', 'completionSha256'
       ])
       OR (SELECT count(*) FROM jsonb_object_keys(v_completion)) <> 3
       OR v_completion ->> 'checkpointSha256' !~ '^[a-f0-9]{64}$'
       OR v_completion ->> 'completionSha256' !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'null'
       OR jsonb_array_length(v_checkpoint -> 'pendingWindows') <> 0 THEN
      RAISE EXCEPTION 'complete incremental cycle metadata is invalid';
    END IF;
    BEGIN
      IF (v_completion ->> 'completedAt')::timestamptz < v_upper THEN
        RAISE EXCEPTION 'incremental completion precedes its upper bound';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'incremental completion timestamp is invalid';
    END;
  ELSE
    IF jsonb_typeof(v_pause) <> 'null'
       OR jsonb_typeof(v_completion) <> 'null'
       OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'number'
       OR p_cycle ->> 'supersededByAttemptNumber' !~ '^[0-9]+$'
       OR (p_cycle ->> 'supersededByAttemptNumber')::integer <>
          (p_cycle ->> 'attemptNumber')::integer + 1 THEN
      RAISE EXCEPTION 'superseded incremental cycle metadata is invalid';
    END IF;
  END IF;
END
$function$;

CREATE FUNCTION dna.save_dna_open_lab_finished_race_incremental_cycle(
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
  v_existing dna.dna_open_lab_finished_race_incremental_attempt%ROWTYPE;
  v_cycle dna.dna_open_lab_finished_race_incremental_cycle%ROWTYPE;
  v_predecessor dna.dna_open_lab_finished_race_incremental_attempt%ROWTYPE;
  v_cycle_id character(64);
  v_attempt_id character(64);
  v_previous_cycle_id character(64);
  v_attempt smallint;
  v_status text;
  v_lower timestamptz;
  v_upper timestamptz;
  v_old_checkpoint jsonb;
  v_new_checkpoint jsonb;
  v_next_revision bigint;
  v_key text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped finished-race incremental cycle denied';
  END IF;
  IF p_expected_revision IS NOT NULL AND p_expected_revision < 1 THEN
    RAISE EXCEPTION 'finished-race incremental expected revision is invalid';
  END IF;
  PERFORM dna.validate_dna_open_lab_finished_race_incremental_cycle(p_cycle);
  v_cycle_id := (p_cycle ->> 'cycleId')::character(64);
  v_attempt_id := (p_cycle ->> 'attemptId')::character(64);
  v_previous_cycle_id := NULLIF(p_cycle ->> 'previousCompletedCycleId', '')::character(64);
  v_attempt := (p_cycle ->> 'attemptNumber')::smallint;
  v_status := p_cycle ->> 'status';
  v_lower := (p_cycle ->> 'lowerBoundAt')::timestamptz;
  v_upper := (p_cycle ->> 'upperBoundAt')::timestamptz;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':finished-race-incremental:' || v_cycle_id::text, 0
  ));
  SELECT stored.* INTO v_existing
  FROM dna.dna_open_lab_finished_race_incremental_attempt stored
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
      RAISE EXCEPTION 'finished-race incremental revision conflict';
    END IF;
    IF v_existing.status IN ('complete', 'superseded') THEN
      RAISE EXCEPTION 'finished-race incremental terminal attempt cannot change';
    END IF;
    IF (v_existing.cycle - 'status' - 'checkpoint' - 'pause' - 'completion'
        - 'supersededByAttemptNumber') <>
       (p_cycle - 'status' - 'checkpoint' - 'pause' - 'completion'
        - 'supersededByAttemptNumber') THEN
      RAISE EXCEPTION 'finished-race incremental authority cannot change';
    END IF;
    v_old_checkpoint := v_existing.cycle -> 'checkpoint';
    v_new_checkpoint := p_cycle -> 'checkpoint';
    FOREACH v_key IN ARRAY ARRAY[
      'completedWindowCount', 'splitCount', 'successfulFinishedRaceRequestCount',
      'raceDocumentRequestCount', 'publishedWindowDocumentCount'
    ] LOOP
      IF (v_new_checkpoint ->> v_key)::bigint <
         (v_old_checkpoint ->> v_key)::bigint THEN
        RAISE EXCEPTION 'finished-race incremental checkpoint regressed';
      END IF;
    END LOOP;
    IF v_old_checkpoint -> 'rootWindow' <> v_new_checkpoint -> 'rootWindow'
       OR v_old_checkpoint -> 'minimumWindowMilliseconds' <>
          v_new_checkpoint -> 'minimumWindowMilliseconds' THEN
      RAISE EXCEPTION 'finished-race incremental checkpoint authority changed';
    END IF;
    IF (
      (v_existing.status = 'running' AND v_status IN ('paused', 'superseded'))
      OR (v_existing.status = 'paused' AND v_status IN ('running', 'superseded'))
    ) AND v_old_checkpoint <> v_new_checkpoint THEN
      RAISE EXCEPTION 'finished-race pause/resume/supersede changed checkpoint';
    END IF;
    IF v_existing.status = 'paused' AND v_status NOT IN ('running', 'superseded') THEN
      RAISE EXCEPTION 'finished-race paused attempt transition is invalid';
    END IF;
    IF v_existing.status = 'running'
       AND v_status NOT IN ('running', 'paused', 'complete', 'superseded') THEN
      RAISE EXCEPTION 'finished-race running attempt transition is invalid';
    END IF;
    IF v_existing.status = 'running' AND v_status = 'running'
       AND v_old_checkpoint = v_new_checkpoint THEN
      RAISE EXCEPTION 'finished-race running attempt made no progress';
    END IF;
    v_next_revision := v_existing.revision + 1;
    UPDATE dna.dna_open_lab_finished_race_incremental_attempt
    SET revision = v_next_revision, status = v_status, cycle = p_cycle,
      attempt_id = v_attempt_id, updated_at = clock_timestamp()
    WHERE owner_id = p_owner_id AND cycle_id = v_cycle_id
      AND attempt_number = v_attempt;
    RETURN QUERY SELECT v_next_revision, p_cycle;
    RETURN;
  END IF;

  IF p_expected_revision IS NOT NULL OR v_status <> 'running' THEN
    RAISE EXCEPTION 'finished-race incremental initial save is invalid';
  END IF;
  SELECT stored.* INTO v_cycle
  FROM dna.dna_open_lab_finished_race_incremental_cycle stored
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF v_attempt <> 1 THEN
      RAISE EXCEPTION 'finished-race incremental cycle must begin at attempt one';
    END IF;
    IF v_previous_cycle_id IS NULL
       AND v_lower <> '2026-09-02T00:11:55.961Z'::timestamptz THEN
      RAISE EXCEPTION 'finished-race first incremental cycle must begin at P5 cutoff';
    END IF;
    IF jsonb_array_length(p_cycle -> 'checkpoint' -> 'pendingWindows') <> 1
       OR p_cycle -> 'checkpoint' -> 'pendingWindows' -> 0 <>
          p_cycle -> 'checkpoint' -> 'rootWindow'
       OR (p_cycle -> 'checkpoint' ->> 'completedWindowCount')::bigint <> 0
       OR (p_cycle -> 'checkpoint' ->> 'splitCount')::bigint <> 0
       OR (p_cycle -> 'checkpoint' ->> 'successfulFinishedRaceRequestCount')::bigint <> 0
       OR (p_cycle -> 'checkpoint' ->> 'raceDocumentRequestCount')::bigint <> 0
       OR (p_cycle -> 'checkpoint' ->> 'publishedWindowDocumentCount')::bigint <> 0 THEN
      RAISE EXCEPTION 'finished-race first incremental attempt must begin unprocessed';
    END IF;
    IF v_previous_cycle_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM dna.dna_open_lab_finished_race_incremental_attempt prior
      JOIN dna.dna_open_lab_finished_race_incremental_cycle prior_cycle
        ON prior_cycle.owner_id = prior.owner_id
       AND prior_cycle.cycle_id = prior.cycle_id
      WHERE prior.owner_id = p_owner_id
        AND prior.cycle_id = v_previous_cycle_id
        AND prior.status = 'complete'
        AND prior_cycle.upper_bound_at = v_lower
    ) THEN
      RAISE EXCEPTION 'finished-race previous completed cycle is unavailable';
    END IF;
    INSERT INTO dna.dna_open_lab_finished_race_incremental_cycle (
      owner_id, cycle_id, source_family, previous_completed_cycle_id,
      lower_bound_at, upper_bound_at
    ) VALUES (
      p_owner_id, v_cycle_id, 'races_finished', v_previous_cycle_id,
      v_lower, v_upper
    );
  ELSE
    IF v_attempt = 1
       OR v_cycle.source_family <> 'races_finished'
       OR v_cycle.previous_completed_cycle_id IS DISTINCT FROM v_previous_cycle_id
       OR v_cycle.lower_bound_at <> v_lower OR v_cycle.upper_bound_at <> v_upper THEN
      RAISE EXCEPTION 'finished-race incremental cycle authority conflicts';
    END IF;
    SELECT prior.* INTO v_predecessor
    FROM dna.dna_open_lab_finished_race_incremental_attempt prior
    WHERE prior.owner_id = p_owner_id AND prior.cycle_id = v_cycle_id
      AND prior.attempt_number = v_attempt - 1;
    IF NOT FOUND OR v_predecessor.status <> 'superseded'
       OR (v_predecessor.cycle ->> 'supersededByAttemptNumber')::integer <> v_attempt
       OR v_predecessor.cycle -> 'checkpoint' <> p_cycle -> 'checkpoint' THEN
      RAISE EXCEPTION 'finished-race replacement attempt authority is invalid';
    END IF;
  END IF;
  INSERT INTO dna.dna_open_lab_finished_race_incremental_attempt (
    owner_id, cycle_id, attempt_number, attempt_id, revision, status, cycle
  ) VALUES (
    p_owner_id, v_cycle_id, v_attempt, v_attempt_id, 1, v_status, p_cycle
  );
  RETURN QUERY SELECT 1::bigint, p_cycle;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_finished_race_incremental_cycle(
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
    RAISE EXCEPTION 'owner-scoped finished-race incremental cycle read denied';
  END IF;
  IF p_cycle_id !~ '^[a-f0-9]{64}$' OR p_attempt_number NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'finished-race incremental cycle read key is invalid';
  END IF;
  RETURN QUERY
  SELECT stored.revision, stored.cycle
  FROM dna.dna_open_lab_finished_race_incremental_attempt stored
  WHERE stored.owner_id = p_owner_id
    AND stored.cycle_id = p_cycle_id::character(64)
    AND stored.attempt_number = p_attempt_number;
END
$function$;

CREATE FUNCTION dna.read_latest_complete_dna_finished_race_incremental_cycle(
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
    RAISE EXCEPTION 'owner-scoped latest finished-race incremental cycle read denied';
  END IF;
  RETURN QUERY
  SELECT stored.revision, stored.cycle
  FROM dna.dna_open_lab_finished_race_incremental_attempt stored
  JOIN dna.dna_open_lab_finished_race_incremental_cycle authority
    ON authority.owner_id = stored.owner_id AND authority.cycle_id = stored.cycle_id
  WHERE stored.owner_id = p_owner_id AND stored.status = 'complete'
  ORDER BY authority.upper_bound_at DESC, stored.attempt_number DESC
  LIMIT 1;
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_open_lab_finished_race_incremental_cycle,
  dna.dna_open_lab_finished_race_incremental_attempt
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  dna.validate_dna_open_lab_finished_race_incremental_cycle(jsonb),
  dna.save_dna_open_lab_finished_race_incremental_cycle(uuid,bigint,jsonb),
  dna.read_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer),
  dna.read_latest_complete_dna_finished_race_incremental_cycle(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  dna.save_dna_open_lab_finished_race_incremental_cycle(uuid,bigint,jsonb),
  dna.read_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer),
  dna.read_latest_complete_dna_finished_race_incremental_cycle(uuid)
TO dna_app_runtime;

COMMIT;

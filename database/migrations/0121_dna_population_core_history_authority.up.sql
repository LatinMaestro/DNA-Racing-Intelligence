BEGIN;

CREATE TABLE dna.dna_population_core_history_authority (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  version smallint NOT NULL CHECK (version = 1),
  evaluated_at timestamptz NOT NULL,
  core_set_sha256 character(64) NOT NULL
    CHECK (core_set_sha256::text ~ '^[a-f0-9]{64}$'),
  core_count integer NOT NULL CHECK (core_count BETWEEN 1 AND 4096),
  core_ids jsonb NOT NULL CHECK (jsonb_typeof(core_ids) = 'array'),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, generation_id)
);

ALTER TABLE dna.dna_population_core_history_authority
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_population_core_history_authority
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_population_core_history_authority
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.reject_dna_population_core_history_authority_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'population Core history authority is immutable';
END
$function$;

CREATE TRIGGER dna_population_core_history_authority_immutable
BEFORE UPDATE OR DELETE ON dna.dna_population_core_history_authority
FOR EACH ROW
EXECUTE FUNCTION dna.reject_dna_population_core_history_authority_mutation();

DO $drop_owned_generation_fk$
DECLARE
  v_constraint text;
BEGIN
  SELECT constraint_row.conname INTO v_constraint
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid =
      'dna.dna_core_race_history_acquisition_cycle'::regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.confrelid = 'dna.dna_open_lab_sync_generation'::regclass;
  IF v_constraint IS NULL THEN
    RAISE EXCEPTION 'Core history owned-generation foreign key is unavailable';
  END IF;
  EXECUTE format(
    'ALTER TABLE dna.dna_core_race_history_acquisition_cycle DROP CONSTRAINT %I',
    v_constraint
  );
END
$drop_owned_generation_fk$;

CREATE FUNCTION dna.begin_dna_population_core_history_acquisition_attempt(
  p_owner_id uuid,
  p_authority jsonb,
  p_cycle jsonb
)
RETURNS TABLE (revision bigint, cycle jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_generation_id uuid;
  v_cycle_id text;
  v_attempt_id text;
  v_previous_cycle_id text;
  v_evaluated_at timestamptz;
  v_core_set_sha text;
  v_core_count integer;
  v_existing dna.dna_population_core_history_authority%ROWTYPE;
  v_existing_attempt dna.dna_core_race_history_acquisition_attempt%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped population Core history acquisition denied';
  END IF;
  PERFORM dna.validate_dna_core_race_history_acquisition_cycle(p_cycle);
  IF jsonb_typeof(p_authority) <> 'object' THEN
    RAISE EXCEPTION 'population Core history authority must be an object';
  END IF;
  SELECT count(*)::integer INTO v_key_count
  FROM jsonb_object_keys(p_authority);
  IF v_key_count <> 4 OR NOT (p_authority ?& ARRAY[
    'version', 'generationId', 'coreSetSha256', 'coreIds'
  ]) OR p_authority ->> 'version' <> '1'
     OR jsonb_typeof(p_authority -> 'generationId') <> 'string'
     OR jsonb_typeof(p_authority -> 'coreSetSha256') <> 'string'
     OR p_authority ->> 'coreSetSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_authority -> 'coreIds') <> 'array' THEN
    RAISE EXCEPTION 'population Core history authority fields are invalid';
  END IF;
  BEGIN
    v_generation_id := (p_authority ->> 'generationId')::uuid;
    v_evaluated_at := (p_cycle ->> 'evaluatedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'population Core history authority identity is invalid';
  END;
  v_cycle_id := p_cycle ->> 'cycleId';
  v_attempt_id := p_cycle ->> 'attemptId';
  v_previous_cycle_id := p_cycle ->> 'previousCompletedCycleId';
  v_core_set_sha := p_authority ->> 'coreSetSha256';
  v_core_count := jsonb_array_length(p_authority -> 'coreIds');
  IF p_cycle ->> 'currentStateGenerationId' <> v_generation_id::text
     OR p_cycle ->> 'coreSetSha256' <> v_core_set_sha
     OR p_cycle -> 'coreIds' <> p_authority -> 'coreIds'
     OR p_cycle ->> 'attemptNumber' <> '1'
     OR p_cycle ->> 'status' <> 'running'
     OR jsonb_typeof(p_cycle -> 'pause') <> 'null'
     OR jsonb_typeof(p_cycle -> 'completion') <> 'null'
     OR jsonb_typeof(p_cycle -> 'supersededByAttemptNumber') <> 'null' THEN
    RAISE EXCEPTION 'population Core history cycle authority is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_owner_id::text || ':population-core-history:' || v_generation_id::text,
      0
    )
  );

  SELECT stored.* INTO v_existing
  FROM dna.dna_population_core_history_authority stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = v_generation_id;
  IF FOUND THEN
    IF v_existing.version <> 1
       OR v_existing.evaluated_at <> v_evaluated_at
       OR v_existing.core_set_sha256 <> v_core_set_sha
       OR v_existing.core_count <> v_core_count
       OR v_existing.core_ids <> p_authority -> 'coreIds' THEN
      RAISE EXCEPTION 'population Core history authority replay conflicts';
    END IF;
  ELSE
    INSERT INTO dna.dna_population_core_history_authority (
      owner_id, generation_id, version, evaluated_at,
      core_set_sha256, core_count, core_ids
    ) VALUES (
      p_owner_id, v_generation_id, 1, v_evaluated_at,
      v_core_set_sha, v_core_count, p_authority -> 'coreIds'
    );
  END IF;

  SELECT stored.* INTO v_existing_attempt
  FROM dna.dna_core_race_history_acquisition_attempt stored
  WHERE stored.owner_id = p_owner_id
    AND stored.cycle_id = v_cycle_id
    AND stored.attempt_number = 1;
  IF FOUND THEN
    IF v_existing_attempt.revision <> 1
       OR v_existing_attempt.attempt_id <> v_attempt_id
       OR v_existing_attempt.status <> 'running'
       OR v_existing_attempt.cycle <> p_cycle THEN
      RAISE EXCEPTION 'population Core history attempt replay conflicts';
    END IF;
    RETURN QUERY SELECT v_existing_attempt.revision, v_existing_attempt.cycle;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.dna_core_race_history_acquisition_cycle stored
    WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
  ) THEN
    RAISE EXCEPTION 'population Core history cycle is incomplete';
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
  INSERT INTO dna.dna_core_race_history_acquisition_attempt (
    owner_id, cycle_id, attempt_number, attempt_id, revision, status, cycle
  ) VALUES (
    p_owner_id, v_cycle_id, 1, v_attempt_id, 1, 'running', p_cycle
  );
  INSERT INTO dna.dna_core_race_history_core_checkpoint (
    owner_id, cycle_id, attempt_number, core_id, core_ordinal,
    revision, status, checkpoint
  )
  SELECT
    p_owner_id, v_cycle_id, 1, entry.value::bigint,
    entry.ordinality::integer, 1, 'running',
    jsonb_build_object(
      'version', 1, 'cycleId', v_cycle_id,
      'attemptNumber', 1, 'coreId', entry.value::bigint,
      'coreOrdinal', entry.ordinality::integer, 'status', 'running',
      'nextPage', 1, 'completedPageCount', 0, 'sourceRowCount', 0,
      'acceptedResultCount', 0, 'quarantineCount', 0,
      'replayDuplicateCount', 0, 'receiptChainSha256', repeat('0', 64),
      'terminalPageNumber', null, 'completionSha256', null
    )
  FROM jsonb_array_elements_text(p_authority -> 'coreIds')
    WITH ORDINALITY entry(value, ordinality);
  RETURN QUERY SELECT 1::bigint, p_cycle;
END
$function$;

REVOKE ALL ON TABLE dna.dna_population_core_history_authority FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_population_core_history_authority
  FROM dna_app_runtime;
REVOKE ALL ON FUNCTION
  dna.reject_dna_population_core_history_authority_mutation()
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  dna.begin_dna_population_core_history_acquisition_attempt(uuid,jsonb,jsonb)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  dna.begin_dna_population_core_history_acquisition_attempt(uuid,jsonb,jsonb)
TO dna_app_runtime;

COMMIT;

BEGIN;

ALTER TABLE dna.dna_core_race_history_generation
  ADD COLUMN entrant_authority_omission_count integer NOT NULL DEFAULT 0
    CHECK (entrant_authority_omission_count BETWEEN 0 AND 500000);

DO $coverage_constraint$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT constraint_record.conname INTO v_constraint_name
  FROM pg_catalog.pg_constraint constraint_record
  WHERE constraint_record.conrelid =
      'dna.dna_core_race_history_generation'::regclass
    AND constraint_record.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid) LIKE
      '%input_result_count%'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid) LIKE
      '%observation_count%'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid) LIKE
      '%replay_duplicate_count%'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid) NOT LIKE
      '%entrant_authority_omission_count%';
  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION 'Core history result coverage constraint is unavailable';
  END IF;
  EXECUTE format(
    'ALTER TABLE dna.dna_core_race_history_generation DROP CONSTRAINT %I',
    v_constraint_name
  );
END
$coverage_constraint$;

ALTER TABLE dna.dna_core_race_history_generation
  ADD CONSTRAINT dna_core_race_history_generation_result_coverage_check CHECK (
    input_result_count = observation_count + replay_duplicate_count
      + entrant_authority_omission_count
  );

CREATE FUNCTION dna.begin_dna_core_race_history_generation_v2(
  p_owner_id uuid,
  p_worker_id text,
  p_generation jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_core_race_history_generation%ROWTYPE;
  v_legacy jsonb;
  v_generation_id character(64);
  v_input_result_count integer;
  v_omission_count integer;
  v_disposition text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Core history generation begin denied';
  END IF;
  IF p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_generation IS NULL OR jsonb_typeof(p_generation) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_generation)) <> 18
     OR NOT (p_generation ?& ARRAY[
       'version', 'generationId', 'materializedAt', 'cycleSetSha256',
       'observationSetSha256', 'payloadSha256', 'inputCycleCount',
       'inputPageCount', 'inputResultCount', 'replayDuplicateCount',
       'raceDocumentCount', 'entrantAuthorityOmissionCount',
       'exactDistanceConfirmedCount', 'acceptedPublishedCellCount',
       'missingFormatCount', 'unsupportedFormatCount',
       'unpublishedCellCount', 'observationCount'
     ])
     OR jsonb_typeof(p_generation -> 'entrantAuthorityOmissionCount') <> 'number'
     OR p_generation ->> 'entrantAuthorityOmissionCount' !~ '^[0-9]+$'
     OR (p_generation ->> 'entrantAuthorityOmissionCount')::numeric > 500000
     OR jsonb_typeof(p_generation -> 'inputResultCount') <> 'number'
     OR p_generation ->> 'inputResultCount' !~ '^[0-9]+$'
     OR (p_generation ->> 'inputResultCount')::numeric > 500000 THEN
    RAISE EXCEPTION 'Core history generation v2 authority is invalid';
  END IF;

  v_input_result_count := (p_generation ->> 'inputResultCount')::integer;
  v_omission_count :=
    (p_generation ->> 'entrantAuthorityOmissionCount')::integer;
  IF v_input_result_count < v_omission_count THEN
    RAISE EXCEPTION 'Core history generation v2 counts disagree';
  END IF;
  v_generation_id := (p_generation ->> 'generationId')::character(64);
  v_legacy := jsonb_set(
    p_generation - 'entrantAuthorityOmissionCount',
    '{inputResultCount}',
    to_jsonb(v_input_result_count - v_omission_count),
    false
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':core-history-generation:' || v_generation_id::text, 0
  ));
  SELECT stored.* INTO v_existing
  FROM dna.dna_core_race_history_generation stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = v_generation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.worker_id <> p_worker_id
       OR v_existing.version <> (p_generation ->> 'version')::smallint
       OR v_existing.materialized_at <>
         (p_generation ->> 'materializedAt')::timestamptz
       OR v_existing.cycle_set_sha256::text <>
         p_generation ->> 'cycleSetSha256'
       OR v_existing.observation_set_sha256::text <>
         p_generation ->> 'observationSetSha256'
       OR v_existing.payload_sha256::text <> p_generation ->> 'payloadSha256'
       OR v_existing.input_cycle_count <>
         (p_generation ->> 'inputCycleCount')::integer
       OR v_existing.input_page_count <>
         (p_generation ->> 'inputPageCount')::integer
       OR v_existing.input_result_count <> v_input_result_count
       OR v_existing.replay_duplicate_count <>
         (p_generation ->> 'replayDuplicateCount')::integer
       OR v_existing.race_document_count <>
         (p_generation ->> 'raceDocumentCount')::integer
       OR v_existing.entrant_authority_omission_count <> v_omission_count
       OR v_existing.exact_distance_confirmed_count <>
         (p_generation ->> 'exactDistanceConfirmedCount')::integer
       OR v_existing.accepted_published_cell_count <>
         (p_generation ->> 'acceptedPublishedCellCount')::integer
       OR v_existing.missing_format_count <>
         (p_generation ->> 'missingFormatCount')::integer
       OR v_existing.unsupported_format_count <>
         (p_generation ->> 'unsupportedFormatCount')::integer
       OR v_existing.unpublished_cell_count <>
         (p_generation ->> 'unpublishedCellCount')::integer
       OR v_existing.observation_count <>
         (p_generation ->> 'observationCount')::integer THEN
      RAISE EXCEPTION 'Core history generation v2 replay conflicts';
    END IF;
    RETURN v_existing.state;
  END IF;

  SELECT dna.begin_dna_core_race_history_generation(
    p_owner_id, p_worker_id, v_legacy
  ) INTO v_disposition;
  UPDATE dna.dna_core_race_history_generation stored
  SET input_result_count = v_input_result_count,
      entrant_authority_omission_count = v_omission_count
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = v_generation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Core history generation v2 begin was not persisted';
  END IF;
  RETURN v_disposition;
END
$function$;

REVOKE ALL ON FUNCTION dna.begin_dna_core_race_history_generation_v2(uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.begin_dna_core_race_history_generation(uuid,text,jsonb) FROM dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.begin_dna_core_race_history_generation_v2(uuid,text,jsonb) TO dna_app_runtime;

COMMIT;

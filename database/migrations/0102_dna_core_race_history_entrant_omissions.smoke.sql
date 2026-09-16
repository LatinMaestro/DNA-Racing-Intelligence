BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('a1020000-0000-4000-8000-000000000001', 'synthetic_core_omission_owner'),
  ('a1020000-0000-4000-8000-000000000002', 'synthetic_core_omission_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_generation',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR has_function_privilege(
       'dna_app_runtime',
       'dna.begin_dna_core_race_history_generation(uuid,text,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.begin_dna_core_race_history_generation_v2(uuid,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Core history entrant omission privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1020000-0000-4000-8000-000000000001';

DO $generation$
DECLARE
  v_owner constant uuid := 'a1020000-0000-4000-8000-000000000001';
  v_generation_id constant text := repeat('6', 64);
  v_worker constant text := 'core-omission-worker';
  v_row_payload constant text :=
    '{"elapsedMilliseconds":60000,"naturalKey":"core-result:42:bike:race-1","sourceCoreId":"42"}';
  v_row_sha text;
  v_payload_sha text;
  v_generation jsonb;
  v_state text;
  v_count integer;
BEGIN
  v_row_sha := encode(sha256(convert_to(v_row_payload, 'UTF8')), 'hex');
  v_payload_sha := encode(sha256(convert_to(
    '0:core-result:42:bike:race-1:' || v_row_sha || E'\n', 'UTF8'
  )), 'hex');
  v_generation := jsonb_build_object(
    'version', 1, 'generationId', v_generation_id,
    'materializedAt', '2026-09-16T08:00:00.000Z',
    'cycleSetSha256', repeat('7', 64),
    'observationSetSha256', repeat('8', 64),
    'payloadSha256', v_payload_sha,
    'inputCycleCount', 1, 'inputPageCount', 2,
    'inputResultCount', 2, 'replayDuplicateCount', 0,
    'raceDocumentCount', 2, 'entrantAuthorityOmissionCount', 1,
    'exactDistanceConfirmedCount', 1,
    'acceptedPublishedCellCount', 1, 'missingFormatCount', 0,
    'unsupportedFormatCount', 0, 'unpublishedCellCount', 0,
    'observationCount', 1
  );

  SELECT dna.begin_dna_core_race_history_generation_v2(
    v_owner, v_worker, v_generation
  ) INTO v_state;
  IF v_state <> 'staging' THEN
    RAISE EXCEPTION 'Core history entrant omission generation did not begin';
  END IF;

  PERFORM dna.stage_dna_core_race_history_generation_rows(
    v_owner, v_worker, v_generation_id, 0,
    jsonb_build_array(jsonb_build_object(
      'ordinal', 0, 'naturalKey', 'core-result:42:bike:race-1',
      'rowSha256', v_row_sha, 'canonicalPayload', v_row_payload,
      'payload', v_row_payload::jsonb
    ))
  );
  SELECT count(*) INTO v_count
  FROM dna.publish_dna_core_race_history_generation(
    v_owner, v_worker, v_generation_id, 1, v_payload_sha,
    '2026-09-16T08:01:00.000Z'
  );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Core history entrant omission generation did not publish';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_core_race_history_generation(v_owner, v_generation_id)
  WHERE input_result_count = 2
    AND observation_count = 1
    AND entrant_authority_omission_count = 1;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Core history entrant omission count was not retained';
  END IF;

  SELECT dna.begin_dna_core_race_history_generation_v2(
    v_owner, v_worker, v_generation
  ) INTO v_state;
  IF v_state <> 'published' THEN
    RAISE EXCEPTION 'Core history entrant omission replay drifted';
  END IF;

  BEGIN
    PERFORM dna.begin_dna_core_race_history_generation_v2(
      v_owner, v_worker,
      jsonb_set(v_generation, '{entrantAuthorityOmissionCount}', '0'::jsonb)
    );
    RAISE EXCEPTION 'Core history entrant omission conflict was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Core history entrant omission conflict was accepted' THEN
      RAISE;
    END IF;
  END;
END
$generation$;

SET LOCAL app.owner_id = 'a1020000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM dna.begin_dna_core_race_history_generation_v2(
      'a1020000-0000-4000-8000-000000000001',
      'core-omission-worker', '{}'::jsonb
    );
    RAISE EXCEPTION 'cross-owner Core history entrant omission was writable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Core history entrant omission was writable' THEN
      RAISE;
    END IF;
  END;
END
$owner_guard$;

ROLLBACK;

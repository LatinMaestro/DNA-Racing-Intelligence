BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('a1040000-0000-4000-8000-000000000001', 'synthetic_core_active_read_owner'),
  ('a1040000-0000-4000-8000-000000000002', 'synthetic_core_active_read_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_generation_row',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_active_dna_core_race_history_generation(uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_active_dna_core_race_history_generation_rows(uuid,integer,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Core history active-read privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1040000-0000-4000-8000-000000000001';

DO $generation$
DECLARE
  v_owner constant uuid := 'a1040000-0000-4000-8000-000000000001';
  v_generation_id constant text := repeat('a', 64);
  v_worker constant text := 'core-active-read-worker';
  v_first_payload constant text :=
    '{"elapsedMilliseconds":60000,"naturalKey":"core-result:42:bike:race-1","sourceCoreId":"42"}';
  v_second_payload constant text :=
    '{"elapsedMilliseconds":61000,"naturalKey":"core-result:42:bike:race-2","sourceCoreId":"42"}';
  v_first_sha text;
  v_second_sha text;
  v_payload_sha text;
  v_generation jsonb;
  v_count integer;
BEGIN
  v_first_sha := encode(sha256(convert_to(v_first_payload, 'UTF8')), 'hex');
  v_second_sha := encode(sha256(convert_to(v_second_payload, 'UTF8')), 'hex');
  v_payload_sha := encode(sha256(convert_to(
    '0:core-result:42:bike:race-1:' || v_first_sha || E'\n'
      || '1:core-result:42:bike:race-2:' || v_second_sha || E'\n',
    'UTF8'
  )), 'hex');
  v_generation := jsonb_build_object(
    'version', 1, 'generationId', v_generation_id,
    'materializedAt', '2026-09-16T10:00:00.000Z',
    'cycleSetSha256', repeat('b', 64),
    'observationSetSha256', repeat('c', 64),
    'payloadSha256', v_payload_sha,
    'inputCycleCount', 1, 'inputPageCount', 1,
    'inputResultCount', 2, 'replayDuplicateCount', 0,
    'raceDocumentCount', 2, 'entrantAuthorityOmissionCount', 0,
    'entrantMismatchOmissionCount', 0, 'exactDistanceConfirmedCount', 2,
    'acceptedPublishedCellCount', 2, 'missingFormatCount', 0,
    'unsupportedFormatCount', 0, 'unpublishedCellCount', 0,
    'observationCount', 2
  );

  PERFORM dna.begin_dna_core_race_history_generation_v3(
    v_owner, v_worker, v_generation
  );
  PERFORM dna.stage_dna_core_race_history_generation_rows(
    v_owner, v_worker, v_generation_id, 0,
    jsonb_build_array(
      jsonb_build_object(
        'ordinal', 0, 'naturalKey', 'core-result:42:bike:race-1',
        'rowSha256', v_first_sha, 'canonicalPayload', v_first_payload,
        'payload', v_first_payload::jsonb
      ),
      jsonb_build_object(
        'ordinal', 1, 'naturalKey', 'core-result:42:bike:race-2',
        'rowSha256', v_second_sha, 'canonicalPayload', v_second_payload,
        'payload', v_second_payload::jsonb
      )
    )
  );
  PERFORM dna.publish_dna_core_race_history_generation(
    v_owner, v_worker, v_generation_id, 2, v_payload_sha,
    '2026-09-16T10:01:00.000Z'
  );

  SELECT count(*) INTO v_count
  FROM dna.read_active_dna_core_race_history_generation(v_owner)
  WHERE generation_id = v_generation_id AND observation_count = 2
    AND state = 'published';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Active Core history generation was not readable';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_active_dna_core_race_history_generation_rows(v_owner, -1, 1)
  WHERE generation_id = v_generation_id AND ordinal = 0
    AND natural_key = 'core-result:42:bike:race-1';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Active Core history first page was not bounded';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_active_dna_core_race_history_generation_rows(v_owner, 0, 250)
  WHERE generation_id = v_generation_id AND ordinal = 1
    AND natural_key = 'core-result:42:bike:race-2';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Active Core history continuation did not resume';
  END IF;

  BEGIN
    PERFORM * FROM dna.read_active_dna_core_race_history_generation_rows(
      v_owner, -1, 251
    );
    RAISE EXCEPTION 'Unbounded active Core history read was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Unbounded active Core history read was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.read_active_dna_core_race_history_generation(
      'a1040000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'Cross-owner active Core history read was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Cross-owner active Core history read was accepted' THEN RAISE; END IF;
  END;
END
$generation$;

ROLLBACK;

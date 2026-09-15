BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('a1010000-0000-4000-8000-000000000001', 'synthetic_core_generation_owner'),
  ('a1010000-0000-4000-8000-000000000002', 'synthetic_core_generation_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_generation',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_generation_row',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_generation_active',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_class relation
       WHERE relation.oid IN (
         'dna.dna_core_race_history_generation'::regclass,
         'dna.dna_core_race_history_generation_row'::regclass,
         'dna.dna_core_race_history_generation_active'::regclass
       ) AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.begin_dna_core_race_history_generation(uuid,text,jsonb)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.stage_dna_core_race_history_generation_rows(uuid,text,text,integer,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.publish_dna_core_race_history_generation(uuid,text,text,integer,text,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_core_race_history_generation(uuid,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Core history generation privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1010000-0000-4000-8000-000000000001';

DO $generation$
DECLARE
  v_owner constant uuid := 'a1010000-0000-4000-8000-000000000001';
  v_generation_id constant text := repeat('1', 64);
  v_worker constant text := 'core-generation-worker';
  v_row_one_payload constant text :=
    '{"elapsedMilliseconds":60000,"naturalKey":"core-result:42:bike:race-1","sourceCoreId":"42"}';
  v_row_two_payload constant text :=
    '{"elapsedMilliseconds":61000,"naturalKey":"core-result:43:bike:race-2","sourceCoreId":"43"}';
  v_row_one_sha text;
  v_row_two_sha text;
  v_payload_sha text;
  v_generation jsonb;
  v_rows jsonb;
  v_result jsonb;
  v_state text;
  v_count integer;
BEGIN
  v_row_one_sha := encode(sha256(convert_to(v_row_one_payload, 'UTF8')), 'hex');
  v_row_two_sha := encode(sha256(convert_to(v_row_two_payload, 'UTF8')), 'hex');
  v_payload_sha := encode(sha256(convert_to(
    '0:core-result:42:bike:race-1:' || v_row_one_sha || E'\n'
      || '1:core-result:43:bike:race-2:' || v_row_two_sha || E'\n',
    'UTF8'
  )), 'hex');
  v_generation := jsonb_build_object(
    'version', 1, 'generationId', v_generation_id,
    'materializedAt', '2026-09-15T08:00:00.000Z',
    'cycleSetSha256', repeat('2', 64),
    'observationSetSha256', repeat('3', 64),
    'payloadSha256', v_payload_sha,
    'inputCycleCount', 1, 'inputPageCount', 4,
    'inputResultCount', 3, 'replayDuplicateCount', 1,
    'raceDocumentCount', 2, 'exactDistanceConfirmedCount', 2,
    'acceptedPublishedCellCount', 1, 'missingFormatCount', 1,
    'unsupportedFormatCount', 0, 'unpublishedCellCount', 0,
    'observationCount', 2
  );
  SELECT dna.begin_dna_core_race_history_generation(
    v_owner, v_worker, v_generation
  ) INTO v_state;
  IF v_state <> 'staging' THEN
    RAISE EXCEPTION 'Core history generation did not begin';
  END IF;

  v_rows := jsonb_build_array(jsonb_build_object(
    'ordinal', 0, 'naturalKey', 'core-result:42:bike:race-1',
    'rowSha256', v_row_one_sha,
    'canonicalPayload', v_row_one_payload,
    'payload', jsonb_build_object(
      'naturalKey', 'core-result:42:bike:race-1',
      'sourceCoreId', '42', 'elapsedMilliseconds', 60000
    )
  ));
  SELECT dna.stage_dna_core_race_history_generation_rows(
    v_owner, v_worker, v_generation_id, 0, v_rows
  ) INTO v_result;
  IF jsonb_array_length(v_result) <> 1
     OR v_result -> 0 ->> 'rowSha256' <> v_row_one_sha THEN
    RAISE EXCEPTION 'Core history first stage response drifted';
  END IF;
  SELECT dna.stage_dna_core_race_history_generation_rows(
    v_owner, v_worker, v_generation_id, 0, v_rows
  ) INTO v_result;
  IF jsonb_array_length(v_result) <> 1 THEN
    RAISE EXCEPTION 'Core history stage replay was not idempotent';
  END IF;

  BEGIN
    PERFORM dna.stage_dna_core_race_history_generation_rows(
      v_owner, v_worker, v_generation_id, 1,
      jsonb_build_array(jsonb_build_object(
        'ordinal', 1, 'naturalKey', 'core-result:43:bike:race-2',
        'rowSha256', repeat('f', 64),
        'canonicalPayload', v_row_two_payload,
        'payload', v_row_two_payload::jsonb
      ))
    );
    RAISE EXCEPTION 'Core history generation accepted a false row checksum';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Core history generation accepted a false row checksum' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.publish_dna_core_race_history_generation(
      v_owner, v_worker, v_generation_id, 2, v_payload_sha,
      '2026-09-15T08:01:00.000Z'
    );
    RAISE EXCEPTION 'incomplete Core history generation published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete Core history generation published' THEN RAISE; END IF;
  END;

  v_rows := jsonb_build_array(jsonb_build_object(
    'ordinal', 1, 'naturalKey', 'core-result:43:bike:race-2',
    'rowSha256', v_row_two_sha,
    'canonicalPayload', v_row_two_payload,
    'payload', jsonb_build_object(
      'naturalKey', 'core-result:43:bike:race-2',
      'sourceCoreId', '43', 'elapsedMilliseconds', 61000
    )
  ));
  PERFORM dna.stage_dna_core_race_history_generation_rows(
    v_owner, v_worker, v_generation_id, 1, v_rows
  );
  SELECT count(*) INTO v_count
  FROM dna.publish_dna_core_race_history_generation(
    v_owner, v_worker, v_generation_id, 2, v_payload_sha,
    '2026-09-15T08:01:00.000Z'
  );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'complete Core history generation did not publish';
  END IF;
  SELECT count(*) INTO v_count
  FROM dna.read_dna_core_race_history_generation(v_owner, v_generation_id);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'published Core history generation is unavailable';
  END IF;
  SELECT dna.begin_dna_core_race_history_generation(
    v_owner, v_worker, v_generation
  ) INTO v_state;
  IF v_state <> 'published' THEN
    RAISE EXCEPTION 'published Core history generation replay drifted';
  END IF;

  BEGIN
    PERFORM dna.stage_dna_core_race_history_generation_rows(
      v_owner, v_worker, v_generation_id, 1,
      jsonb_build_array(jsonb_build_object(
        'ordinal', 1, 'naturalKey', 'core-result:43:bike:race-2',
        'rowSha256', repeat('f', 64),
        'canonicalPayload', '{"naturalKey":"core-result:43:bike:race-2"}',
        'payload', jsonb_build_object(
          'naturalKey', 'core-result:43:bike:race-2'
        )
      ))
    );
    RAISE EXCEPTION 'published Core history generation accepted staging';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published Core history generation accepted staging' THEN RAISE; END IF;
  END;
END
$generation$;

SET LOCAL app.owner_id = 'a1010000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_core_race_history_generation(
      'a1010000-0000-4000-8000-000000000001', repeat('1', 64)
    );
    RAISE EXCEPTION 'cross-owner Core history generation was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Core history generation was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('a1410000-0000-4000-8000-000000000001', 'synthetic_selected_core_read_owner'),
  ('a1410000-0000-4000-8000-000000000002', 'synthetic_selected_core_read_other');

DO $privileges$
BEGIN
  IF NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_selected_dna_core_race_history_rows(uuid,character,character,text[],integer)',
       'EXECUTE'
     ) OR EXISTS (
       SELECT 1 FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = 'dna.read_selected_dna_core_race_history_rows(uuid,character,character,text[],integer)'::regprocedure
         AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     ) OR has_table_privilege(
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
SET LOCAL app.owner_id = 'a1410000-0000-4000-8000-000000000001';

DO $generation$
DECLARE
  v_owner constant uuid := 'a1410000-0000-4000-8000-000000000001';
  v_generation_id constant text := repeat('a', 64);
  v_worker constant text := 'core-active-read-worker';
  v_first_payload constant text :=
    '{"elapsedMilliseconds":60000,"naturalKey":"core-result:42:bike:race-1","sourceCoreId":"42"}';
  v_second_payload constant text :=
    '{"elapsedMilliseconds":61000,"naturalKey":"core-result:43:bike:race-2","sourceCoreId":"43"}';
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
      || '1:core-result:43:bike:race-2:' || v_second_sha || E'\n',
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
        'ordinal', 1, 'naturalKey', 'core-result:43:bike:race-2',
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
  FROM dna.read_selected_dna_core_race_history_rows(
    v_owner, v_generation_id, repeat('c',64), ARRAY['42'], 10001
  ) WHERE ordinal = 0 AND payload ->> 'sourceCoreId' = '42';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Selected Core scope failed'; END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_selected_dna_core_race_history_rows(
    v_owner, v_generation_id, repeat('c',64), ARRAY['43'], 10001
  ) WHERE ordinal = 1 AND payload ->> 'sourceCoreId' = '43';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Selected second Core failed'; END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_selected_dna_core_race_history_rows(
    v_owner, v_generation_id, repeat('c',64), ARRAY['42','43'], 1
  );
  IF v_count <> 1 THEN RAISE EXCEPTION 'Selected Core bound failed'; END IF;

  IF EXISTS (SELECT 1 FROM dna.read_selected_dna_core_race_history_rows(
    v_owner, repeat('d',64), repeat('c',64), ARRAY['42'], 1
  )) OR EXISTS (SELECT 1 FROM dna.read_selected_dna_core_race_history_rows(
    v_owner, v_generation_id, repeat('d',64), ARRAY['42'], 1
  )) THEN RAISE EXCEPTION 'Generation or digest drift was accepted'; END IF;

  BEGIN
    PERFORM * FROM dna.read_selected_dna_core_race_history_rows(
      'a1410000-0000-4000-8000-000000000002', v_generation_id, repeat('c',64), ARRAY['42'], 1
    );
    RAISE EXCEPTION 'Cross-owner selected Core read accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Cross-owner selected Core read accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.read_selected_dna_core_race_history_rows(
      v_owner, v_generation_id, repeat('c',64), ARRAY['42'], 10002
    );
    RAISE EXCEPTION 'Selected Core overflow accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Selected Core overflow accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.read_selected_dna_core_race_history_rows(
      v_owner, v_generation_id, repeat('c',64), ARRAY['42','42'], 1
    );
    RAISE EXCEPTION 'Duplicate Core selection accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Duplicate Core selection accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.read_selected_dna_core_race_history_rows(
      v_owner, v_generation_id, repeat('c',64), ARRAY[]::text[], 1
    );
    RAISE EXCEPTION 'Empty Core selection accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Empty Core selection accepted' THEN RAISE; END IF;
  END;
END
$generation$;

ROLLBACK;

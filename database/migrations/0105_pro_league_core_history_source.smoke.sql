BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('a1050000-0000-4000-8000-000000000001', 'synthetic_pro_league_api_owner'),
  ('a1050000-0000-4000-8000-000000000002', 'synthetic_pro_league_api_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime', 'dna.pro_league_evidence_generation',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.begin_pro_league_evidence_generation_from_core_history(uuid,uuid,character,text,character,timestamp with time zone,bigint,bigint,bigint,bigint,bigint,bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.publish_pro_league_evidence_generation_from_core_history(uuid,uuid,text,integer,integer,bigint,character,timestamp with time zone)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Pro League Core history evidence privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1050000-0000-4000-8000-000000000001';

DO $commission$
DECLARE
  v_owner constant uuid := 'a1050000-0000-4000-8000-000000000001';
  v_source_id constant text := repeat('a', 64);
  v_evidence_id constant uuid := 'a1050000-0000-4000-8000-000000000101';
  v_worker constant text := 'pro-league-api-evidence-worker';
  v_source_payload constant text :=
    '{"distanceAuthority":"result_and_race_document","distanceMetres":1000,"elapsedMilliseconds":60000,"eventAt":"2026-09-16T09:00:00.000Z","finishPosition":1,"gateCount":2,"mode":"bike","naturalKey":"core-result:42:bike:race-1","payoutMechanismSourceValue":"1v1","sourceCoreId":"42"}';
  v_source_row_sha text;
  v_source_payload_sha text;
  v_generation jsonb;
  v_benchmark_stage jsonb;
  v_profile_stage jsonb;
  v_benchmark_sha text;
  v_profile_sha text;
  v_payload_sha text;
  v_state text;
  v_count integer;
BEGIN
  v_source_row_sha := encode(sha256(convert_to(v_source_payload, 'UTF8')), 'hex');
  v_source_payload_sha := encode(sha256(convert_to(
    '0:core-result:42:bike:race-1:' || v_source_row_sha || E'\n', 'UTF8'
  )), 'hex');
  v_generation := jsonb_build_object(
    'version', 1, 'generationId', v_source_id,
    'materializedAt', '2026-09-16T10:00:00.000Z',
    'cycleSetSha256', repeat('b', 64),
    'observationSetSha256', repeat('c', 64),
    'payloadSha256', v_source_payload_sha,
    'inputCycleCount', 1, 'inputPageCount', 1,
    'inputResultCount', 1, 'replayDuplicateCount', 0,
    'raceDocumentCount', 1, 'entrantAuthorityOmissionCount', 0,
    'entrantMismatchOmissionCount', 0, 'exactDistanceConfirmedCount', 1,
    'acceptedPublishedCellCount', 1, 'missingFormatCount', 0,
    'unsupportedFormatCount', 0, 'unpublishedCellCount', 0,
    'observationCount', 1
  );
  PERFORM dna.begin_dna_core_race_history_generation_v3(
    v_owner, 'core-source-worker', v_generation
  );
  PERFORM dna.stage_dna_core_race_history_generation_rows(
    v_owner, 'core-source-worker', v_source_id, 0,
    jsonb_build_array(jsonb_build_object(
      'ordinal', 0, 'naturalKey', 'core-result:42:bike:race-1',
      'rowSha256', v_source_row_sha, 'canonicalPayload', v_source_payload,
      'payload', v_source_payload::jsonb
    ))
  );
  PERFORM dna.publish_dna_core_race_history_generation(
    v_owner, 'core-source-worker', v_source_id, 1, v_source_payload_sha,
    '2026-09-16T10:01:00.000Z'
  );

  SELECT dna.begin_pro_league_evidence_generation_from_core_history(
    v_owner, v_evidence_id, v_source_id::character(64), v_worker,
    repeat('c', 64)::character(64), '2026-09-16T10:00:00.000Z',
    1, 1, 0, 0, 0, 0
  ) INTO v_state;
  IF v_state <> 'staging' THEN
    RAISE EXCEPTION 'Pro League Core history evidence did not begin';
  END IF;

  SELECT dna.stage_pro_league_evidence_rows(
    v_owner, v_evidence_id, v_worker, 'benchmark', 0,
    jsonb_build_array(jsonb_build_object(
      'naturalKey', '["1v1",1000]',
      'payload', jsonb_build_object('raceType', '1v1', 'distanceMetres', 1000)
    ))
  ) INTO v_benchmark_stage;
  SELECT dna.stage_pro_league_evidence_rows(
    v_owner, v_evidence_id, v_worker, 'profile', 0,
    jsonb_build_array(jsonb_build_object(
      'naturalKey', '["42","1v1",1000]',
      'payload', jsonb_build_object(
        'sourceCoreId', '42', 'raceType', '1v1', 'distanceMetres', 1000
      )
    ))
  ) INTO v_profile_stage;
  v_benchmark_sha := encode(sha256(convert_to(
    '0:' || (v_benchmark_stage -> 0 ->> 'sha256') || E'\n', 'UTF8'
  )), 'hex');
  v_profile_sha := encode(sha256(convert_to(
    '0:' || (v_profile_stage -> 0 ->> 'sha256') || E'\n', 'UTF8'
  )), 'hex');
  v_payload_sha := encode(sha256(convert_to(
    'benchmark:1:' || v_benchmark_sha || E'\n'
      || 'profile:1:' || v_profile_sha || E'\n', 'UTF8'
  )), 'hex');

  BEGIN
    PERFORM * FROM dna.publish_pro_league_evidence_generation(
      v_owner, v_evidence_id, v_worker, 1, 1, 0,
      v_payload_sha::character(64), '2026-09-16T10:02:00.000Z'
    );
    RAISE EXCEPTION 'legacy publication accepted a Core history source';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'legacy publication accepted a Core history source' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_count
  FROM dna.publish_pro_league_evidence_generation_from_core_history(
    v_owner, v_evidence_id, v_worker, 1, 1, 0,
    v_payload_sha::character(64), '2026-09-16T10:02:00.000Z'
  );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Pro League Core history evidence did not publish';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_active_pro_league_evidence_generation(v_owner)
  WHERE generation_id = v_evidence_id
    AND source_kind = 'core_history_generation'
    AND race_dataset_version_id IS NULL
    AND core_history_generation_id = v_source_id::character(64)
    AND benchmark_count = 1 AND profile_count = 1;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'active Pro League Core history evidence is unavailable';
  END IF;

  SELECT dna.begin_pro_league_evidence_generation_from_core_history(
    v_owner, v_evidence_id, v_source_id::character(64), v_worker,
    repeat('c', 64)::character(64), '2026-09-16T10:00:00.000Z',
    1, 1, 0, 0, 0, 0
  ) INTO v_state;
  IF v_state <> 'published' THEN
    RAISE EXCEPTION 'Pro League Core history evidence replay drifted';
  END IF;

  BEGIN
    PERFORM dna.begin_pro_league_evidence_generation_from_core_history(
      v_owner, 'a1050000-0000-4000-8000-000000000102',
      repeat('f', 64)::character(64), v_worker,
      repeat('c', 64)::character(64), '2026-09-16T10:00:00.000Z',
      1, 1, 0, 0, 0, 0
    );
    RAISE EXCEPTION 'inactive Core history source was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'inactive Core history source was accepted' THEN RAISE; END IF;
  END;
END
$commission$;

SET LOCAL app.owner_id = 'a1050000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM dna.begin_pro_league_evidence_generation_from_core_history(
      'a1050000-0000-4000-8000-000000000001',
      'a1050000-0000-4000-8000-000000000103',
      repeat('a', 64)::character(64), 'pro-league-api-evidence-worker',
      repeat('c', 64)::character(64), '2026-09-16T10:00:00.000Z',
      1, 1, 0, 0, 0, 0
    );
    RAISE EXCEPTION 'cross-owner Pro League Core history evidence was writable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Pro League Core history evidence was writable' THEN
      RAISE;
    END IF;
  END;
END
$owner_guard$;

ROLLBACK;

BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1420000-0000-4000-8000-000000000001', 'smoke_history_context_owner'),
  ('a1420000-0000-4000-8000-000000000002', 'smoke_history_context_other');

INSERT INTO dna.dna_core_race_history_generation (
  owner_id, generation_id, version, worker_id, materialized_at,
  cycle_set_sha256, observation_set_sha256, payload_sha256,
  input_cycle_count, input_page_count, input_result_count,
  replay_duplicate_count, race_document_count, exact_distance_confirmed_count,
  accepted_published_cell_count, missing_format_count,
  unsupported_format_count, unpublished_cell_count, observation_count,
  state, published_at)
VALUES ('a1420000-0000-4000-8000-000000000001', repeat('a',64), 1,
  'smoke-history-context', clock_timestamp() - interval '5 minutes',
  repeat('b',64), repeat('c',64), repeat('d',64),
  1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  'published', clock_timestamp() - interval '4 minutes');
INSERT INTO dna.dna_core_race_history_generation_active
  (owner_id, generation_id, activated_at)
VALUES ('a1420000-0000-4000-8000-000000000001', repeat('a',64),
  clock_timestamp() - interval '4 minutes');

DO $permissions$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'open_race_history_context_generation',
    'open_race_history_context_generation_row',
    'open_race_history_context_generation_active'] LOOP
    IF has_table_privilege('dna_app_runtime', 'dna.' || v_table,
        'SELECT,INSERT,UPDATE,DELETE')
      OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
        WHERE oid = ('dna.' || v_table)::regclass)
    THEN RAISE EXCEPTION 'Historical Race context table security is unsafe'; END IF;
  END LOOP;
  IF has_database_privilege('dna_app_runtime', current_database(), 'CREATE')
    OR has_schema_privilege('dna_app_runtime', 'dna', 'CREATE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.begin_open_race_history_context_generation(uuid,text,text,text)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.stage_open_race_history_context_rows(uuid,text,text,integer,jsonb)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.publish_open_race_history_context_generation(uuid,text,text,timestamptz)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_active_open_race_history_context_pointer(uuid)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_open_race_history_contexts(uuid,text,text[],integer)','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) acl
      WHERE p.oid IN (
        'dna.begin_open_race_history_context_generation(uuid,text,text,text)'::regprocedure,
        'dna.stage_open_race_history_context_rows(uuid,text,text,integer,jsonb)'::regprocedure,
        'dna.publish_open_race_history_context_generation(uuid,text,text,timestamptz)'::regprocedure,
        'dna.read_active_open_race_history_context_pointer(uuid)'::regprocedure,
        'dna.read_open_race_history_contexts(uuid,text,text[],integer)'::regprocedure)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
  THEN RAISE EXCEPTION 'Historical Race context function security is unsafe'; END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1420000-0000-4000-8000-000000000001';

DO $publication$
DECLARE v_owner constant uuid := 'a1420000-0000-4000-8000-000000000001';
  v_worker constant text := 'history-context-worker';
  v_first text; v_second text; v_first_sha text; v_second_sha text;
  v_row_set_sha text; v_manifest text; v_identity text; v_status text;
  v_bad_manifest text; v_bad_identity text;
BEGIN
  v_first := jsonb_build_object(
    'eventId','race-1','competition','normal',
    'element',jsonb_build_object('status','not_applicable','value',NULL),
    'evidenceSha256',repeat('e',64))::text;
  v_second := jsonb_build_object(
    'eventId','race-2','competition','esports',
    'element',jsonb_build_object('status','known','value','Metal'),
    'evidenceSha256',repeat('f',64))::text;
  v_first_sha := encode(sha256(convert_to(v_first,'UTF8')),'hex');
  v_second_sha := encode(sha256(convert_to(v_second,'UTF8')),'hex');
  v_row_set_sha := encode(sha256(convert_to(
    '0:race-1:' || v_first_sha || E'\n' || '1:race-2:' || v_second_sha || E'\n',
    'UTF8')),'hex');
  v_manifest := jsonb_build_object(
    'version',1,'historyGenerationVersion',repeat('a',64),
    'observationSetSha256',repeat('c',64),
    'historicalAggregateVersion','aggregate-v8',
    'evidenceCutoff','2026-10-18T00:00:00.000Z',
    'publicationState','accepted','expectedRowCount',2,
    'rowSetSha256',v_row_set_sha,
    'materializedAt',to_char((clock_timestamp() - interval '2 minutes') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text;
  v_identity := encode(sha256(convert_to(v_manifest,'UTF8')),'hex');

  SELECT dna.begin_open_race_history_context_generation(
    v_owner,v_worker,v_identity,v_manifest) INTO v_status;
  IF v_status <> 'staging' THEN RAISE EXCEPTION 'Context generation did not begin'; END IF;
  PERFORM dna.stage_open_race_history_context_rows(v_owner,v_worker,v_identity,0,
    jsonb_build_array(
      jsonb_build_object('ordinal',0,'rowSha256',v_first_sha,
        'canonicalPayload',v_first,'payload',v_first::jsonb),
      jsonb_build_object('ordinal',1,'rowSha256',v_second_sha,
        'canonicalPayload',v_second,'payload',v_second::jsonb)));
  SELECT dna.publish_open_race_history_context_generation(
    v_owner,v_worker,v_identity,clock_timestamp() - interval '30 seconds') INTO v_status;
  IF v_status <> 'published' THEN RAISE EXCEPTION 'Context generation did not publish'; END IF;
  IF (SELECT count(*) FROM dna.read_active_open_race_history_context_pointer(v_owner)
      WHERE context_source_identity_sha256 = v_identity
        AND history_generation_version = repeat('a',64)
        AND observation_set_sha256 = repeat('c',64)
        AND historical_aggregate_version = 'aggregate-v8'
        AND publication_state = 'accepted' AND expected_row_count = 2) <> 1
  THEN RAISE EXCEPTION 'Active context pointer is invalid'; END IF;
  IF (SELECT count(*) FROM dna.read_open_race_history_contexts(
      v_owner,v_identity,ARRAY['race-1','race-2'],3)
      WHERE row_sha256 IN (v_first_sha,v_second_sha)) <> 2
  THEN RAISE EXCEPTION 'Bounded context read is invalid'; END IF;
  SELECT dna.begin_open_race_history_context_generation(
    v_owner,v_worker,v_identity,v_manifest) INTO v_status;
  IF v_status <> 'unchanged' THEN RAISE EXCEPTION 'Context replay was not idempotent'; END IF;

  BEGIN
    PERFORM dna.read_active_open_race_history_context_pointer(
      'a1420000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Cross-owner context read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner context read accepted' THEN RAISE; END IF;
  END;

  v_bad_manifest := jsonb_build_object(
    'version',1,'historyGenerationVersion',repeat('a',64),
    'observationSetSha256',repeat('c',64),
    'historicalAggregateVersion','aggregate-incomplete',
    'evidenceCutoff','2026-10-18T00:00:00.000Z',
    'publicationState','accepted','expectedRowCount',1,
    'rowSetSha256',repeat('9',64),
    'materializedAt',to_char((clock_timestamp() - interval '1 minute') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text;
  v_bad_identity := encode(sha256(convert_to(v_bad_manifest,'UTF8')),'hex');
  PERFORM dna.begin_open_race_history_context_generation(
    v_owner,v_worker,v_bad_identity,v_bad_manifest);
  BEGIN
    PERFORM dna.publish_open_race_history_context_generation(
      v_owner,v_worker,v_bad_identity,clock_timestamp() - interval '10 seconds');
    RAISE EXCEPTION 'Incomplete context generation published';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Incomplete context generation published' THEN RAISE; END IF;
  END;
  IF (SELECT context_source_identity_sha256
      FROM dna.read_active_open_race_history_context_pointer(v_owner)) <> v_identity
  THEN RAISE EXCEPTION 'Incomplete generation replaced last-good context'; END IF;
END
$publication$;

RESET ROLE;
ROLLBACK;

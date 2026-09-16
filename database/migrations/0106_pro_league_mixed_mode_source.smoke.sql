BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('a1060000-0000-4000-8000-000000000001', 'synthetic_mixed_mode_owner');

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1060000-0000-4000-8000-000000000001';

DO $commission$
DECLARE
  v_owner constant uuid := 'a1060000-0000-4000-8000-000000000001';
  v_source_id constant text := repeat('a', 64);
  v_evidence_id constant uuid := 'a1060000-0000-4000-8000-000000000101';
  v_worker constant text := 'pro-league-mixed-mode-evidence';
  v_source_payload constant text :=
    '{"mode":"horse","naturalKey":"core-result:42:horse:race-1","publishedCellStatus":"accepted","sourceCoreId":"42"}';
  v_source_row_sha text;
  v_source_payload_sha text;
  v_generation jsonb;
  v_empty_family_sha text;
  v_payload_sha text;
  v_state text;
  v_count integer;
BEGIN
  v_source_row_sha := encode(
    sha256(convert_to(v_source_payload, 'UTF8')), 'hex'
  );
  v_source_payload_sha := encode(sha256(convert_to(
    '0:core-result:42:horse:race-1:' || v_source_row_sha || E'\n',
    'UTF8'
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
    v_owner, 'mixed-mode-source-worker', v_generation
  );
  PERFORM dna.stage_dna_core_race_history_generation_rows(
    v_owner, 'mixed-mode-source-worker', v_source_id, 0,
    jsonb_build_array(jsonb_build_object(
      'ordinal', 0, 'naturalKey', 'core-result:42:horse:race-1',
      'rowSha256', v_source_row_sha, 'canonicalPayload', v_source_payload,
      'payload', v_source_payload::jsonb
    ))
  );
  PERFORM dna.publish_dna_core_race_history_generation(
    v_owner, 'mixed-mode-source-worker', v_source_id, 1,
    v_source_payload_sha, '2026-09-16T10:01:00.000Z'
  );

  SELECT dna.begin_pro_league_evidence_generation_from_core_history(
    v_owner, v_evidence_id, v_source_id::character(64), v_worker,
    repeat('c', 64)::character(64), '2026-09-16T10:00:00.000Z',
    1, 0, 1, 0, 0, 0
  ) INTO v_state;
  IF v_state <> 'staging' THEN
    RAISE EXCEPTION 'mixed-mode Pro League evidence did not begin';
  END IF;

  v_empty_family_sha := encode(
    sha256(convert_to('', 'UTF8')), 'hex'
  );
  v_payload_sha := encode(sha256(convert_to(
    'benchmark:0:' || v_empty_family_sha || E'\n'
      || 'profile:0:' || v_empty_family_sha || E'\n',
    'UTF8'
  )), 'hex');
  SELECT count(*) INTO v_count
  FROM dna.publish_pro_league_evidence_generation_from_core_history(
    v_owner, v_evidence_id, v_worker, 0, 0, 0,
    v_payload_sha::character(64), '2026-09-16T10:02:00.000Z'
  );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mixed-mode Pro League evidence did not publish';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_active_pro_league_evidence_generation(v_owner)
  WHERE generation_id = v_evidence_id
    AND source_kind = 'core_history_generation'
    AND input_observation_count = 1
    AND accepted_entry_count = 0
    AND non_bike_entry_count = 1
    AND benchmark_count = 0
    AND profile_count = 0;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mixed-mode Pro League evidence is unavailable';
  END IF;

  BEGIN
    PERFORM dna.begin_pro_league_evidence_generation_from_core_history(
      v_owner, 'a1060000-0000-4000-8000-000000000102',
      v_source_id::character(64), v_worker,
      repeat('c', 64)::character(64), '2026-09-16T10:00:00.000Z',
      1, 1, 0, 0, 0, 0
    );
    RAISE EXCEPTION 'mixed-mode source accepted a false Bike partition';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'mixed-mode source accepted a false Bike partition' THEN
      RAISE;
    END IF;
  END;
END
$commission$;

ROLLBACK;

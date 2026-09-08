BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('91000000-0000-4000-8000-000000000001', 'synthetic_incremental_publication_owner'),
  ('91000000-0000-4000-8000-000000000002', 'synthetic_incremental_publication_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_finished_race_incremental_publication', 'SELECT'
     )
     OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_finished_race_incremental_active', 'SELECT'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_finished_race_incremental_receipts(uuid,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.publish_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer,integer,bigint,bigint,character,timestamp with time zone,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_finished_race_incremental_last_good(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'finished-race incremental publication privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '91000000-0000-4000-8000-000000000001';

DO $publication$
DECLARE
  v_owner constant uuid := '91000000-0000-4000-8000-000000000001';
  v_cycle_id constant text := repeat('a', 64);
  v_cycle jsonb;
  v_hash character(64);
  v_result record;
BEGIN
  v_cycle := jsonb_build_object(
    'version', 1, 'cycleId', v_cycle_id, 'attemptId', repeat('b', 64),
    'previousCompletedCycleId', null, 'sourceFamily', 'races_finished',
    'lowerBoundAt', '2026-09-02T00:11:55.961Z',
    'upperBoundAt', '2026-09-03T00:11:55.961Z',
    'attemptNumber', 1, 'status', 'complete',
    'checkpoint', jsonb_build_object(
      'version', 1,
      'rootWindow', jsonb_build_object(
        'startTime', '2026-09-02T00:11:55.961Z',
        'endTime', '2026-09-03T00:11:55.961Z'
      ),
      'pendingWindows', jsonb_build_array(),
      'minimumWindowMilliseconds', 1, 'completedWindowCount', 2,
      'splitCount', 1, 'successfulFinishedRaceRequestCount', 3,
      'raceDocumentRequestCount', 2, 'publishedWindowDocumentCount', 3,
      'identityOmissionAuthority', null, 'omittedIdentityObservationCount', 0
    ),
    'pause', null,
    'completion', jsonb_build_object(
      'completedAt', '2026-09-03T00:12:00.000Z',
      'checkpointSha256', repeat('c', 64),
      'completionSha256', repeat('d', 64)
    ),
    'supersededByAttemptNumber', null
  );
  INSERT INTO dna.dna_open_lab_finished_race_incremental_cycle (
    owner_id, cycle_id, source_family, previous_completed_cycle_id,
    lower_bound_at, upper_bound_at
  ) VALUES (
    v_owner, v_cycle_id, 'races_finished', NULL,
    '2026-09-02T00:11:55.961Z', '2026-09-03T00:11:55.961Z'
  );
  INSERT INTO dna.dna_open_lab_finished_race_incremental_attempt (
    owner_id, cycle_id, attempt_number, attempt_id, revision, status, cycle
  ) VALUES (v_owner, v_cycle_id, 1, repeat('b', 64), 4, 'complete', v_cycle);
  INSERT INTO dna.dna_open_lab_finished_race_incremental_window_receipt (
    owner_id, cycle_id, first_attempt_number, window_key, content_sha256,
    document_count, manifest_object_key, manifest_body_sha256,
    manifest_byte_length, window_start_at, window_end_at
  ) VALUES (
    v_owner, v_cycle_id, 1, repeat('e', 64), repeat('1', 64), 1,
    'dna-open-lab/v1/' || repeat('2', 64) || '/races/finished-windows/'
      || repeat('e', 64) || '.json',
    repeat('3', 64), 256,
    '2026-09-02T00:11:55.961Z', '2026-09-02T12:11:55.961Z'
  );

  BEGIN
    PERFORM * FROM dna.publish_dna_open_lab_finished_race_incremental_cycle(
      v_owner, v_cycle_id, 1, 2, 3, 512, repeat('0', 64),
      '2026-09-03T00:13:00Z', '2026-09-03T00:14:00Z'
    );
    RAISE EXCEPTION 'partial finished-race receipt set was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'partial finished-race receipt set was published' THEN RAISE; END IF;
  END;

  INSERT INTO dna.dna_open_lab_finished_race_incremental_window_receipt (
    owner_id, cycle_id, first_attempt_number, window_key, content_sha256,
    document_count, manifest_object_key, manifest_body_sha256,
    manifest_byte_length, window_start_at, window_end_at
  ) VALUES (
    v_owner, v_cycle_id, 1, repeat('f', 64), repeat('4', 64), 2,
    'dna-open-lab/v1/' || repeat('2', 64) || '/races/finished-windows/'
      || repeat('f', 64) || '.json',
    repeat('5', 64), 256,
    '2026-09-02T12:11:55.961Z', '2026-09-03T00:11:55.961Z'
  );
  WITH ordered AS (
    SELECT receipt.*,
      concat_ws('|',
        ((extract(epoch FROM receipt.window_start_at) * 1000)::bigint)::text,
        ((extract(epoch FROM receipt.window_end_at) * 1000)::bigint)::text,
        receipt.window_key::text, receipt.content_sha256::text,
        receipt.document_count::text,
        octet_length(receipt.manifest_object_key)::text || ':' || receipt.manifest_object_key,
        receipt.manifest_body_sha256::text, receipt.manifest_byte_length::text
      ) AS hash_line
    FROM dna.dna_open_lab_finished_race_incremental_window_receipt receipt
    WHERE receipt.owner_id = v_owner AND receipt.cycle_id = v_cycle_id
  )
  SELECT encode(sha256(convert_to(string_agg(
    ordered.hash_line, E'\n' ORDER BY ordered.window_start_at,
    ordered.window_end_at, ordered.window_key
  ), 'UTF8')), 'hex')::character(64)
  INTO v_hash FROM ordered;

  SELECT * INTO v_result
  FROM dna.publish_dna_open_lab_finished_race_incremental_cycle(
    v_owner, v_cycle_id, 1, 2, 3, 512, v_hash,
    '2026-09-03T00:13:00Z', '2026-09-03T00:14:00Z'
  );
  IF v_result.cycle_id <> v_cycle_id OR v_result.receipt_count <> 2
     OR v_result.document_count <> 3 OR v_result.receipt_set_sha256 <> v_hash
     OR (SELECT count(*) FROM dna.read_dna_open_lab_finished_race_incremental_last_good(v_owner)) <> 1 THEN
    RAISE EXCEPTION 'finished-race cycle did not publish atomically';
  END IF;
  PERFORM * FROM dna.publish_dna_open_lab_finished_race_incremental_cycle(
    v_owner, v_cycle_id, 1, 2, 3, 512, v_hash,
    '2026-09-03T00:13:00Z', '2026-09-03T00:14:00Z'
  );
  BEGIN
    PERFORM * FROM dna.publish_dna_open_lab_finished_race_incremental_cycle(
      v_owner, v_cycle_id, 1, 2, 3, 512, repeat('9', 64),
      '2026-09-03T00:13:00Z', '2026-09-03T00:14:00Z'
    );
    RAISE EXCEPTION 'conflicting finished-race publication replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting finished-race publication replay was accepted' THEN RAISE; END IF;
  END;
END
$publication$;

SET LOCAL app.owner_id = '91000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_finished_race_incremental_last_good(
      '91000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner finished-race publication read was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner finished-race publication read was accepted' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

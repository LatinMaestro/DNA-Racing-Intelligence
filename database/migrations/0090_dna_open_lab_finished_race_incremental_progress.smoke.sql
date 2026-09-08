BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('90000000-0000-4000-8000-000000000001', 'synthetic_incremental_progress_owner'),
  ('90000000-0000-4000-8000-000000000002', 'synthetic_incremental_progress_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_finished_race_incremental_window_receipt', 'SELECT'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.save_dna_open_lab_finished_race_incremental_progress(uuid,bigint,jsonb,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'finished-race incremental progress privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '90000000-0000-4000-8000-000000000001';

DO $progress$
DECLARE
  v_owner constant uuid := '90000000-0000-4000-8000-000000000001';
  v_cycle_id constant text := repeat('a', 64);
  v_cycle jsonb;
  v_checkpoint jsonb;
  v_publication jsonb;
  v_revision bigint;
  v_count bigint;
BEGIN
  v_checkpoint := jsonb_build_object(
    'version', 1,
    'rootWindow', jsonb_build_object(
      'startTime', '2026-09-02T00:11:55.961Z',
      'endTime', '2026-09-03T00:11:55.961Z'
    ),
    'pendingWindows', jsonb_build_array(jsonb_build_object(
      'startTime', '2026-09-02T00:11:55.961Z',
      'endTime', '2026-09-03T00:11:55.961Z'
    )),
    'minimumWindowMilliseconds', 1,
    'completedWindowCount', 0,
    'splitCount', 0,
    'successfulFinishedRaceRequestCount', 0,
    'raceDocumentRequestCount', 0,
    'publishedWindowDocumentCount', 0,
    'identityOmissionAuthority', null,
    'omittedIdentityObservationCount', 0
  );
  v_cycle := jsonb_build_object(
    'version', 1, 'cycleId', v_cycle_id, 'attemptId', repeat('b', 64),
    'previousCompletedCycleId', null, 'sourceFamily', 'races_finished',
    'lowerBoundAt', '2026-09-02T00:11:55.961Z',
    'upperBoundAt', '2026-09-03T00:11:55.961Z',
    'attemptNumber', 1, 'status', 'running', 'checkpoint', v_checkpoint,
    'pause', null, 'completion', null, 'supersededByAttemptNumber', null
  );
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, NULL, v_cycle
  ) saved;
  IF v_revision <> 1 THEN RAISE EXCEPTION 'progress cycle did not begin'; END IF;

  v_checkpoint := jsonb_set(v_checkpoint, '{pendingWindows}', jsonb_build_array(
    jsonb_build_object(
      'startTime', '2026-09-02T00:11:55.961Z',
      'endTime', '2026-09-02T12:11:55.961Z'
    ),
    jsonb_build_object(
      'startTime', '2026-09-02T12:11:55.961Z',
      'endTime', '2026-09-03T00:11:55.961Z'
    )
  ));
  v_checkpoint := jsonb_set(v_checkpoint, '{splitCount}', '1'::jsonb);
  v_checkpoint := jsonb_set(
    v_checkpoint, '{successfulFinishedRaceRequestCount}', '1'::jsonb
  );
  v_cycle := jsonb_set(v_cycle, '{checkpoint}', v_checkpoint);
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_progress(
    v_owner, 1, v_cycle, NULL
  ) saved;
  IF v_revision <> 2 THEN RAISE EXCEPTION 'split progress did not advance'; END IF;
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_progress(
    v_owner, 1, v_cycle, NULL
  ) saved;
  IF v_revision <> 2 THEN RAISE EXCEPTION 'split replay drifted'; END IF;

  BEGIN
    PERFORM * FROM dna.save_dna_open_lab_finished_race_incremental_progress(
      v_owner, 2,
      jsonb_set(v_cycle, '{checkpoint,splitCount}', '3'::jsonb), NULL
    );
    RAISE EXCEPTION 'invalid split progress was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid split progress was accepted' THEN RAISE; END IF;
  END;

  v_checkpoint := jsonb_set(v_checkpoint, '{pendingWindows}', jsonb_build_array(
    jsonb_build_object(
      'startTime', '2026-09-02T12:11:55.961Z',
      'endTime', '2026-09-03T00:11:55.961Z'
    )
  ));
  v_checkpoint := jsonb_set(v_checkpoint, '{completedWindowCount}', '1'::jsonb);
  v_checkpoint := jsonb_set(
    v_checkpoint, '{successfulFinishedRaceRequestCount}', '2'::jsonb
  );
  v_checkpoint := jsonb_set(v_checkpoint, '{raceDocumentRequestCount}', '1'::jsonb);
  v_checkpoint := jsonb_set(
    v_checkpoint, '{publishedWindowDocumentCount}', '1'::jsonb
  );
  v_cycle := jsonb_set(v_cycle, '{checkpoint}', v_checkpoint);
  v_publication := jsonb_build_object(
    'window', jsonb_build_object(
      'startTime', '2026-09-02T00:11:55.961Z',
      'endTime', '2026-09-02T12:11:55.961Z'
    ),
    'receipt', jsonb_build_object(
      'windowKey', repeat('c', 64), 'contentSha256', repeat('d', 64),
      'documentCount', 1,
      'manifestObjectKey', 'dna-open-lab/v1/' || repeat('e', 64)
        || '/races/finished-windows/' || repeat('c', 64) || '.json',
      'manifestBodySha256', repeat('f', 64), 'manifestByteLength', 256
    )
  );
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_progress(
    v_owner, 2, v_cycle, v_publication
  ) saved;
  IF v_revision <> 3 THEN RAISE EXCEPTION 'publication progress did not advance'; END IF;
  SELECT count(*) INTO v_count
  FROM dna.dna_open_lab_finished_race_incremental_window_receipt receipt
  WHERE receipt.owner_id = v_owner AND receipt.cycle_id = v_cycle_id
    AND receipt.first_attempt_number = 1
    AND receipt.window_key = repeat('c', 64)::character(64)
    AND receipt.window_start_at = '2026-09-02T00:11:55.961Z'::timestamptz
    AND receipt.window_end_at = '2026-09-02T12:11:55.961Z'::timestamptz;
  IF v_count <> 1 THEN RAISE EXCEPTION 'publication receipt was not bound'; END IF;
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_progress(
    v_owner, 2, v_cycle, v_publication
  ) saved;
  IF v_revision <> 3 THEN RAISE EXCEPTION 'publication replay drifted'; END IF;

  BEGIN
    PERFORM * FROM dna.save_dna_open_lab_finished_race_incremental_progress(
      v_owner, 2, v_cycle,
      jsonb_set(v_publication, '{receipt,contentSha256}', to_jsonb(repeat('0', 64)))
    );
    RAISE EXCEPTION 'conflicting publication replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting publication replay was accepted' THEN RAISE; END IF;
  END;
END
$progress$;

SET LOCAL app.owner_id = '90000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.save_dna_open_lab_finished_race_incremental_progress(
      '90000000-0000-4000-8000-000000000001', 3,
      jsonb_build_object(), NULL
    );
    RAISE EXCEPTION 'cross-owner incremental progress was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner incremental progress was accepted' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

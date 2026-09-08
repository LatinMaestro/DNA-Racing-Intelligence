BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('89000000-0000-4000-8000-000000000001', 'synthetic_incremental_cycle_owner'),
  ('89000000-0000-4000-8000-000000000002', 'synthetic_incremental_cycle_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_finished_race_incremental_cycle', 'SELECT'
     )
     OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_open_lab_finished_race_incremental_attempt', 'SELECT'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.save_dna_open_lab_finished_race_incremental_cycle(uuid,bigint,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_latest_complete_dna_finished_race_incremental_cycle(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'finished-race incremental cycle privileges are unsafe';
  END IF;
END
$privileges$;

-- A synthetic immutable historical row proves the additive model never resets
-- or overwrites the completed P5 checkpoint table.
DO $historical_fixture$
BEGIN
  IF to_regclass('dna.dna_open_lab_finished_race_backfill_checkpoint') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO dna.dna_open_lab_finished_race_backfill_checkpoint (
        owner_id, revision, checkpoint, updated_at
      ) VALUES (
        '89000000-0000-4000-8000-000000000001', 77,
        '{"historical":"immutable-p5-baseline"}'::jsonb,
        '2026-09-02T00:20:00Z'
      )
    $sql$;
  END IF;
END
$historical_fixture$;

SET LOCAL app.owner_id = '89000000-0000-4000-8000-000000000001';

DO $lifecycle$
DECLARE
  v_owner constant uuid := '89000000-0000-4000-8000-000000000001';
  v_cycle_one constant text := repeat('1', 64);
  v_attempt_one constant text := repeat('2', 64);
  v_cycle_two constant text := repeat('3', 64);
  v_attempt_two_one constant text := repeat('4', 64);
  v_attempt_two_two constant text := repeat('5', 64);
  v_checkpoint jsonb := jsonb_build_object(
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
  v_cycle jsonb;
  v_stored jsonb;
  v_revision bigint;
  v_historical_unchanged boolean;
BEGIN
  v_cycle := jsonb_build_object(
    'version', 1, 'cycleId', v_cycle_one, 'attemptId', v_attempt_one,
    'previousCompletedCycleId', null, 'sourceFamily', 'races_finished',
    'lowerBoundAt', '2026-09-02T00:11:55.961Z',
    'upperBoundAt', '2026-09-03T00:11:55.961Z',
    'attemptNumber', 1, 'status', 'running', 'checkpoint', v_checkpoint,
    'pause', null, 'completion', null, 'supersededByAttemptNumber', null
  );
  SELECT saved.revision, saved.cycle INTO v_revision, v_stored
  FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, NULL, v_cycle
  ) saved;
  IF v_revision <> 1 OR v_stored <> v_cycle THEN
    RAISE EXCEPTION 'incremental cycle did not begin';
  END IF;
  -- Exact create replay is idempotent.
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, NULL, v_cycle
  ) saved;
  IF v_revision <> 1 THEN RAISE EXCEPTION 'incremental create replay drifted'; END IF;

  v_cycle := jsonb_set(v_cycle, '{status}', '"paused"'::jsonb);
  v_cycle := jsonb_set(v_cycle, '{pause}', jsonb_build_object(
    'reason', 'rate_limited', 'pausedAt', '2026-09-03T00:12:00Z',
    'retryAt', '2026-09-03T00:13:00Z'
  ));
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, 1, v_cycle
  ) saved;
  IF v_revision <> 2 THEN RAISE EXCEPTION 'incremental pause did not advance'; END IF;

  v_cycle := jsonb_set(v_cycle, '{status}', '"running"'::jsonb);
  v_cycle := jsonb_set(v_cycle, '{pause}', 'null'::jsonb);
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, 2, v_cycle
  ) saved;
  IF v_revision <> 3 THEN RAISE EXCEPTION 'incremental resume did not advance'; END IF;

  v_checkpoint := jsonb_set(v_checkpoint, '{pendingWindows}', '[]'::jsonb);
  v_checkpoint := jsonb_set(v_checkpoint, '{completedWindowCount}', '1'::jsonb);
  v_checkpoint := jsonb_set(v_checkpoint, '{successfulFinishedRaceRequestCount}', '1'::jsonb);
  v_checkpoint := jsonb_set(v_checkpoint, '{raceDocumentRequestCount}', '1'::jsonb);
  v_checkpoint := jsonb_set(v_checkpoint, '{publishedWindowDocumentCount}', '7'::jsonb);
  v_cycle := jsonb_set(v_cycle, '{checkpoint}', v_checkpoint);
  v_cycle := jsonb_set(v_cycle, '{status}', '"complete"'::jsonb);
  v_cycle := jsonb_set(v_cycle, '{completion}', jsonb_build_object(
    'completedAt', '2026-09-03T00:15:00Z',
    'checkpointSha256', repeat('6', 64),
    'completionSha256', repeat('7', 64)
  ));
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, 3, v_cycle
  ) saved;
  IF v_revision <> 4 THEN RAISE EXCEPTION 'incremental completion did not advance'; END IF;
  SELECT latest.cycle INTO v_stored
  FROM dna.read_latest_complete_dna_finished_race_incremental_cycle(v_owner) latest;
  IF v_stored ->> 'cycleId' <> v_cycle_one THEN
    RAISE EXCEPTION 'latest complete incremental cycle was not readable';
  END IF;

  -- A later cycle chains to the complete prior cycle, can be superseded, and
  -- resumes from exactly the same checkpoint in attempt two.
  v_checkpoint := jsonb_build_object(
    'version', 1,
    'rootWindow', jsonb_build_object(
      'startTime', '2026-09-03T00:11:55.961Z',
      'endTime', '2026-09-04T00:11:55.961Z'
    ),
    'pendingWindows', jsonb_build_array(jsonb_build_object(
      'startTime', '2026-09-03T00:11:55.961Z',
      'endTime', '2026-09-04T00:11:55.961Z'
    )),
    'minimumWindowMilliseconds', 1,
    'completedWindowCount', 0, 'splitCount', 0,
    'successfulFinishedRaceRequestCount', 0, 'raceDocumentRequestCount', 0,
    'publishedWindowDocumentCount', 0,
    'identityOmissionAuthority', null, 'omittedIdentityObservationCount', 0
  );
  v_cycle := jsonb_build_object(
    'version', 1, 'cycleId', v_cycle_two, 'attemptId', v_attempt_two_one,
    'previousCompletedCycleId', v_cycle_one, 'sourceFamily', 'races_finished',
    'lowerBoundAt', '2026-09-03T00:11:55.961Z',
    'upperBoundAt', '2026-09-04T00:11:55.961Z',
    'attemptNumber', 1, 'status', 'running', 'checkpoint', v_checkpoint,
    'pause', null, 'completion', null, 'supersededByAttemptNumber', null
  );
  PERFORM * FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, NULL, v_cycle
  );
  v_cycle := jsonb_set(v_cycle, '{status}', '"superseded"'::jsonb);
  v_cycle := jsonb_set(v_cycle, '{supersededByAttemptNumber}', '2'::jsonb);
  PERFORM * FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, 1, v_cycle
  );
  v_cycle := jsonb_set(v_cycle, '{attemptNumber}', '2'::jsonb);
  v_cycle := jsonb_set(v_cycle, '{attemptId}', to_jsonb(v_attempt_two_two));
  v_cycle := jsonb_set(v_cycle, '{status}', '"running"'::jsonb);
  v_cycle := jsonb_set(v_cycle, '{supersededByAttemptNumber}', 'null'::jsonb);
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    v_owner, NULL, v_cycle
  ) saved;
  IF v_revision <> 1 THEN RAISE EXCEPTION 'replacement attempt did not begin'; END IF;

  IF to_regclass('dna.dna_open_lab_finished_race_backfill_checkpoint') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT revision = 77
        AND checkpoint = '{"historical":"immutable-p5-baseline"}'::jsonb
      FROM dna.dna_open_lab_finished_race_backfill_checkpoint
      WHERE owner_id = '89000000-0000-4000-8000-000000000001'
    $sql$ INTO v_historical_unchanged;
    IF v_historical_unchanged IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'incremental cycle altered the P5 historical checkpoint';
    END IF;
  END IF;

  BEGIN
    v_cycle := jsonb_set(v_cycle, '{checkpoint,completedWindowCount}', '1'::jsonb);
    PERFORM * FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
      v_owner, NULL, v_cycle
    );
    RAISE EXCEPTION 'conflicting replacement replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting replacement replay was accepted' THEN RAISE; END IF;
  END;
END
$lifecycle$;

SET LOCAL app.owner_id = '89000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_finished_race_incremental_cycle(
      '89000000-0000-4000-8000-000000000001', repeat('1', 64), 1
    );
    RAISE EXCEPTION 'cross-owner incremental cycle was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner incremental cycle was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

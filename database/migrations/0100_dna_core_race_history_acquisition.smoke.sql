BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'synthetic_core_history_owner'),
  ('a0000000-0000-4000-8000-000000000002', 'synthetic_core_history_other');

INSERT INTO dna.dna_open_lab_sync_generation (
  owner_id, id, observed_at, recorded_at, status, published_at
) VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000011',
    '2026-09-15 05:59:00+00', '2026-09-15 05:59:30+00',
    'published', '2026-09-15 05:59:45+00'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000012',
    '2026-09-15 06:09:00+00', '2026-09-15 06:09:30+00',
    'published', '2026-09-15 06:09:45+00'
  );

INSERT INTO dna.dna_open_lab_owned_core_snapshot (
  owner_id, generation_id, source_core_id, display_name, core_class,
  element, f_number, sex, observed_at, raw_evidence_sha256
) VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000011', 42, 'Synthetic Core 42',
    'Morphed', 'Metal', 16, 'female', '2026-09-15 05:59:00+00', repeat('1', 64)
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000011', 43, 'Synthetic Core 43',
    'Morphed', 'Fire', 17, 'male', '2026-09-15 05:59:00+00', repeat('2', 64)
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000012', 42, 'Synthetic Core 42',
    'Morphed', 'Metal', 16, 'female', '2026-09-15 06:09:00+00', repeat('3', 64)
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000012', 43, 'Synthetic Core 43',
    'Morphed', 'Fire', 17, 'male', '2026-09-15 06:09:00+00', repeat('4', 64)
  );

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_acquisition_cycle', 'SELECT'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_acquisition_attempt', 'SELECT'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_core_checkpoint', 'SELECT'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_page_receipt', 'SELECT'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_acquisition_cycle',
       'INSERT,UPDATE,DELETE'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_acquisition_attempt',
       'INSERT,UPDATE,DELETE'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_core_checkpoint',
       'INSERT,UPDATE,DELETE'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.dna_core_race_history_page_receipt',
       'INSERT,UPDATE,DELETE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class relation
       WHERE relation.oid IN (
         'dna.dna_core_race_history_acquisition_cycle'::regclass,
         'dna.dna_core_race_history_acquisition_attempt'::regclass,
         'dna.dna_core_race_history_core_checkpoint'::regclass,
         'dna.dna_core_race_history_page_receipt'::regclass
       ) AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.save_dna_core_race_history_acquisition_attempt(uuid,bigint,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.save_dna_core_race_history_page_progress(uuid,bigint,jsonb,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_core_race_history_acquisition_attempt(uuid,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_latest_complete_dna_core_race_history_acquisition(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_next_dna_core_race_history_checkpoint(uuid,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_core_race_history_checkpoints(uuid,text,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Core history acquisition privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a0000000-0000-4000-8000-000000000001';

DO $cycle$
DECLARE
  v_owner constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_cycle_id constant text := repeat('a', 64);
  v_cycle jsonb;
  v_second_cycle jsonb;
  v_checkpoint jsonb;
  v_receipt jsonb;
  v_revision bigint;
  v_core bigint;
  v_count integer;
BEGIN
  v_cycle := jsonb_build_object(
    'version', 1, 'cycleId', repeat('0', 64), 'attemptId', repeat('1', 64),
    'previousCompletedCycleId', null, 'sourceFamily', 'core_race_history',
    'currentStateGenerationId', 'a0000000-0000-4000-8000-000000000011',
    'evaluatedAt', '2026-09-15T06:00:00.000Z',
    'coreSetSha256', repeat('2', 64), 'coreIds', jsonb_build_array(42),
    'attemptNumber', 1, 'status', 'running', 'pause', null,
    'completion', null, 'supersededByAttemptNumber', null
  );
  BEGIN
    PERFORM * FROM dna.save_dna_core_race_history_acquisition_attempt(
      v_owner, NULL, v_cycle
    );
    RAISE EXCEPTION 'incomplete owned Core authority was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete owned Core authority was accepted' THEN RAISE; END IF;
  END;

  v_cycle := jsonb_build_object(
    'version', 1, 'cycleId', v_cycle_id, 'attemptId', repeat('b', 64),
    'previousCompletedCycleId', null, 'sourceFamily', 'core_race_history',
    'currentStateGenerationId', 'a0000000-0000-4000-8000-000000000011',
    'evaluatedAt', '2026-09-15T06:00:00.000Z',
    'coreSetSha256', repeat('c', 64), 'coreIds', jsonb_build_array(42, 43),
    'attemptNumber', 1, 'status', 'running', 'pause', null,
    'completion', null, 'supersededByAttemptNumber', null
  );
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_core_race_history_acquisition_attempt(
    v_owner, NULL, v_cycle
  ) saved;
  IF v_revision <> 1 THEN
    RAISE EXCEPTION 'Core history cycle did not begin';
  END IF;
  SELECT (checkpoint ->> 'coreId')::bigint INTO v_core
  FROM dna.read_next_dna_core_race_history_checkpoint(v_owner, v_cycle_id, 1);
  IF v_core <> 42 THEN
    RAISE EXCEPTION 'Core history checkpoint order drifted';
  END IF;

  FOREACH v_core IN ARRAY ARRAY[42::bigint, 43::bigint]
  LOOP
    v_checkpoint := jsonb_build_object(
      'version', 1, 'cycleId', v_cycle_id, 'attemptNumber', 1,
      'coreId', v_core, 'coreOrdinal', CASE WHEN v_core = 42 THEN 1 ELSE 2 END,
      'status', 'complete', 'nextPage', 2, 'completedPageCount', 1,
      'sourceRowCount', 0, 'acceptedResultCount', 0,
      'quarantineCount', 0, 'replayDuplicateCount', 0,
      'receiptChainSha256', repeat(CASE WHEN v_core = 42 THEN 'd' ELSE 'e' END, 64),
      'terminalPageNumber', 1,
      'completionSha256', repeat(CASE WHEN v_core = 42 THEN 'f' ELSE '1' END, 64)
    );
    v_receipt := jsonb_build_object(
      'version', 1, 'cycleId', v_cycle_id, 'attemptNumber', 1,
      'coreId', v_core, 'pageNumber', 1,
      'observedAt', '2026-09-15T06:01:00.000Z',
      'sourceRowCount', 0, 'acceptedResultCount', 0,
      'quarantineCount', 0, 'replayDuplicateCount', 0, 'terminal', true,
      'pageObjectKey', 'dna-open-lab/v1/' || repeat('2', 64)
        || '/core-race-history/cycles/' || v_cycle_id
        || '/attempts/1/cores/' || repeat(CASE WHEN v_core = 42 THEN '3' ELSE '4' END, 64)
        || '/pages/1.json',
      'pageBodySha256', repeat('5', 64), 'pageByteLength', 256,
      'quarantineObjectKey', null, 'quarantineBodySha256', null,
      'quarantineByteLength', null,
      'receiptSha256', repeat(CASE WHEN v_core = 42 THEN '6' ELSE '7' END, 64)
    );
    SELECT saved.revision INTO v_revision
    FROM dna.save_dna_core_race_history_page_progress(
      v_owner, 1, v_checkpoint, v_receipt
    ) saved;
    IF v_revision <> 2 THEN
      RAISE EXCEPTION 'Core history page progress did not advance';
    END IF;
    SELECT saved.revision INTO v_revision
    FROM dna.save_dna_core_race_history_page_progress(
      v_owner, 1, v_checkpoint, v_receipt
    ) saved;
    IF v_revision <> 2 THEN
      RAISE EXCEPTION 'Core history page replay drifted';
    END IF;
  END LOOP;

  v_cycle := jsonb_set(v_cycle, '{status}', '"complete"'::jsonb);
  v_cycle := jsonb_set(v_cycle, '{completion}', jsonb_build_object(
    'completedAt', '2026-09-15T06:02:00.000Z', 'completedCoreCount', 2,
    'pageReceiptCount', 2, 'sourceRowCount', 0, 'acceptedResultCount', 0,
    'quarantineCount', 0, 'replayDuplicateCount', 0,
    'coreCompletionSetSha256', repeat('8', 64),
    'completionSha256', repeat('9', 64)
  ));
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_core_race_history_acquisition_attempt(
    v_owner, 1, v_cycle
  ) saved;
  IF v_revision <> 2 THEN
    RAISE EXCEPTION 'Core history cycle did not complete';
  END IF;
  SELECT count(*) INTO v_count
  FROM dna.read_latest_complete_dna_core_race_history_acquisition(v_owner);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Core history latest completion is unavailable';
  END IF;

  v_second_cycle := jsonb_build_object(
    'version', 1, 'cycleId', repeat('2', 64), 'attemptId', repeat('3', 64),
    'previousCompletedCycleId', v_cycle_id,
    'sourceFamily', 'core_race_history',
    'currentStateGenerationId', 'a0000000-0000-4000-8000-000000000012',
    'evaluatedAt', '2026-09-15T06:10:00.000Z',
    'coreSetSha256', repeat('4', 64), 'coreIds', jsonb_build_array(42, 43),
    'attemptNumber', 1, 'status', 'running', 'pause', null,
    'completion', null, 'supersededByAttemptNumber', null
  );
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_core_race_history_acquisition_attempt(
    v_owner, NULL, v_second_cycle
  ) saved;
  IF v_revision <> 1 THEN
    RAISE EXCEPTION 'next Core history cycle did not begin';
  END IF;

  v_second_cycle := jsonb_set(v_second_cycle, '{status}', '"paused"'::jsonb);
  v_second_cycle := jsonb_set(v_second_cycle, '{pause}', jsonb_build_object(
    'reason', 'rate_limited', 'pausedAt', '2026-09-15T06:11:00.000Z',
    'retryAt', '2026-09-15T06:12:00.000Z'
  ));
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_core_race_history_acquisition_attempt(
    v_owner, 1, v_second_cycle
  ) saved;
  IF v_revision <> 2 THEN
    RAISE EXCEPTION 'Core history pause did not preserve the attempt';
  END IF;

  v_second_cycle := jsonb_set(v_second_cycle, '{status}', '"superseded"'::jsonb);
  v_second_cycle := jsonb_set(v_second_cycle, '{pause}', 'null'::jsonb);
  v_second_cycle := jsonb_set(
    v_second_cycle, '{supersededByAttemptNumber}', '2'::jsonb
  );
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_core_race_history_acquisition_attempt(
    v_owner, 2, v_second_cycle
  ) saved;
  IF v_revision <> 3 THEN
    RAISE EXCEPTION 'Core history supersession did not become terminal';
  END IF;

  v_second_cycle := jsonb_set(v_second_cycle, '{attemptNumber}', '2'::jsonb);
  v_second_cycle := jsonb_set(
    v_second_cycle, '{attemptId}', to_jsonb(repeat('5', 64))
  );
  v_second_cycle := jsonb_set(v_second_cycle, '{status}', '"running"'::jsonb);
  v_second_cycle := jsonb_set(
    v_second_cycle, '{supersededByAttemptNumber}', 'null'::jsonb
  );
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_core_race_history_acquisition_attempt(
    v_owner, NULL, v_second_cycle
  ) saved;
  IF v_revision <> 1 THEN
    RAISE EXCEPTION 'Core history replacement attempt did not begin cleanly';
  END IF;
  SELECT (checkpoint ->> 'nextPage')::integer INTO v_count
  FROM dna.read_next_dna_core_race_history_checkpoint(
    v_owner, repeat('2', 64), 2
  );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Core history replacement retained superseded progress';
  END IF;

  BEGIN
    PERFORM * FROM dna.save_dna_core_race_history_page_progress(
      v_owner, 2, v_checkpoint, v_receipt
    );
    RAISE EXCEPTION 'complete Core history attempt accepted new progress';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'complete Core history attempt accepted new progress' THEN RAISE; END IF;
  END;
END
$cycle$;

SET LOCAL app.owner_id = 'a0000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_latest_complete_dna_core_race_history_acquisition(
      'a0000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner Core history acquisition was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Core history acquisition was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

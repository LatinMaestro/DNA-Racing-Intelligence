BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('75000000-0000-4000-8000-000000000001', 'synthetic_cycle_owner'),
  ('75000000-0000-4000-8000-000000000002', 'synthetic_cycle_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_current_state_acquisition_cycle', 'SELECT'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.save_dna_open_lab_current_state_acquisition_cycle(uuid,uuid,bigint,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.read_dna_open_lab_current_state_acquisition_cycle(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'current-state acquisition runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '75000000-0000-4000-8000-000000000001';

DO $cycle_lifecycle$
DECLARE
  v_cycle_id uuid := '75000000-0000-4000-8000-000000000010';
  v_revision bigint;
  v_checkpoint jsonb;
  v_initial jsonb := jsonb_build_object(
    'version', 1,
    'cycleId', '75000000-0000-4000-8000-000000000010',
    'evaluatedAt', '2026-08-28T00:00:00.000Z',
    'scheduleSha256', repeat('a', 64),
    'status', 'running',
    'scheduledRequestKeys', jsonb_build_array(repeat('1', 64), repeat('2', 64)),
    'receipts', '[]'::jsonb,
    'completedGroups', '[]'::jsonb,
    'pauseReason', NULL,
    'retryNotBefore', NULL
  );
  v_paused jsonb;
  v_resumed jsonb;
  v_first jsonb;
  v_complete jsonb;
  v_ready jsonb;
BEGIN
  v_paused := jsonb_set(
    jsonb_set(v_initial, '{status}', '"paused"'),
    '{pauseReason}', '"rate_limited"'
  );
  v_paused := jsonb_set(
    v_paused, '{retryNotBefore}', '"2026-08-28T00:01:00.000Z"'
  );
  v_resumed := v_initial;
  v_first := jsonb_set(v_initial, '{receipts}', jsonb_build_array(
    jsonb_build_object(
      'requestKey', repeat('1', 64),
      'observedAt', '2026-08-28T00:00:10.000Z',
      'contentSha256', repeat('3', 64),
      'evidenceObjectKey', 'synthetic/current-state/first.json'
    )
  ));
  v_first := jsonb_set(
    v_first, '{completedGroups}', '["race_activity"]'::jsonb
  );
  v_complete := jsonb_set(v_first, '{receipts}', (v_first -> 'receipts') ||
    jsonb_build_array(jsonb_build_object(
      'requestKey', repeat('2', 64),
      'observedAt', '2026-08-28T00:00:20.000Z',
      'contentSha256', repeat('4', 64),
      'evidenceObjectKey', 'synthetic/current-state/second.json'
    ))
  );
  v_complete := jsonb_set(
    v_complete, '{completedGroups}', '["race_activity","token_prices"]'::jsonb
  );
  v_ready := jsonb_set(v_complete, '{status}', '"ready_to_publish"');

  SELECT saved.revision, saved.checkpoint INTO v_revision, v_checkpoint
  FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id, NULL, v_initial
  ) saved;
  IF v_revision <> 1 OR v_checkpoint <> v_initial THEN
    RAISE EXCEPTION 'initial current-state acquisition cycle was not stored';
  END IF;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id, NULL, v_initial
  ) saved;
  IF v_revision <> 1 THEN
    RAISE EXCEPTION 'initial current-state acquisition replay was not idempotent';
  END IF;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id, 1, v_paused
  ) saved;
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id, 2, v_resumed
  ) saved;
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id, 3, v_first
  ) saved;
  IF v_revision <> 4 THEN
    RAISE EXCEPTION 'current-state acquisition receipt did not advance';
  END IF;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id, 3, v_first
  ) saved;
  IF v_revision <> 4 THEN
    RAISE EXCEPTION 'current-state acquisition receipt replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
      '75000000-0000-4000-8000-000000000001', v_cycle_id, 3,
      jsonb_set(v_first, '{receipts,0,contentSha256}', to_jsonb(repeat('9', 64)))
    );
    RAISE EXCEPTION 'conflicting current-state acquisition replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting current-state acquisition replay was accepted' THEN
      RAISE;
    END IF;
  END;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id, 4, v_complete
  ) saved;
  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id, 5, v_ready
  ) saved;
  IF v_revision <> 6 THEN
    RAISE EXCEPTION 'current-state acquisition terminal state was not stored';
  END IF;

  SELECT stored.revision, stored.checkpoint INTO v_revision, v_checkpoint
  FROM dna.read_dna_open_lab_current_state_acquisition_cycle(
    '75000000-0000-4000-8000-000000000001', v_cycle_id
  ) stored;
  IF v_revision <> 6 OR v_checkpoint <> v_ready THEN
    RAISE EXCEPTION 'current-state acquisition cycle read is incorrect';
  END IF;

  BEGIN
    PERFORM * FROM dna.save_dna_open_lab_current_state_acquisition_cycle(
      '75000000-0000-4000-8000-000000000001', v_cycle_id, 6,
      jsonb_set(v_ready, '{status}', '"awaiting_evidence"')
    );
    RAISE EXCEPTION 'terminal current-state acquisition cycle advanced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'terminal current-state acquisition cycle advanced' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM dna.validate_dna_open_lab_current_state_acquisition_cycle(
      v_cycle_id,
      jsonb_set(v_first, '{receipts,0,requestKey}', to_jsonb(repeat('2', 64)))
    );
    RAISE EXCEPTION 'out-of-order current-state acquisition receipt was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'out-of-order current-state acquisition receipt was accepted' THEN
      RAISE;
    END IF;
  END;
END
$cycle_lifecycle$;

SET LOCAL app.owner_id = '75000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_current_state_acquisition_cycle(
      '75000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000010'
    );
    RAISE EXCEPTION 'cross-owner current-state acquisition cycle was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner current-state acquisition cycle was readable' THEN
      RAISE;
    END IF;
  END;
END
$owner_guard$;

ROLLBACK;

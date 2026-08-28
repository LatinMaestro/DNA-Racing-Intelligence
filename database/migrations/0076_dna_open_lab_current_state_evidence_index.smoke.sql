BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('76000000-0000-4000-8000-000000000001', 'synthetic_index_owner'),
  ('76000000-0000-4000-8000-000000000002', 'synthetic_index_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_current_state_evidence_index', 'SELECT'
  ) OR has_function_privilege(
    'dna_app_runtime',
    'dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.save_dna_open_lab_current_state_evidence_index(uuid,uuid,jsonb,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.publish_dna_open_lab_indexed_sync_candidate(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.read_dna_open_lab_serving_current_state_evidence_index(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'current-state evidence index runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '76000000-0000-4000-8000-000000000001';

DO $index_lifecycle$
DECLARE
  v_generation_id uuid := '76000000-0000-4000-8000-000000000010';
  v_index jsonb := jsonb_build_object(
    'version', 1,
    'generationId', '76000000-0000-4000-8000-000000000010',
    'planSha256', repeat('a', 64),
    'indexedAt', '2026-08-28T12:01:00.000Z',
    'receipts', jsonb_build_array(
      jsonb_build_object(
        'group', 'vault_identity',
        'requestKey', repeat('1', 64),
        'cycleId', '76000000-0000-4000-8000-000000000011',
        'observedAt', '2026-08-28T12:00:10.000Z',
        'contentSha256', repeat('2', 64),
        'evidenceObjectKey', 'private/synthetic/first.json'
      ),
      jsonb_build_object(
        'group', 'core_current_state',
        'requestKey', repeat('3', 64),
        'cycleId', '76000000-0000-4000-8000-000000000011',
        'observedAt', '2026-08-28T12:00:20.000Z',
        'contentSha256', repeat('4', 64),
        'evidenceObjectKey', 'private/synthetic/second.json'
      )
    )
  );
  v_families jsonb := jsonb_build_object(
    'vault', jsonb_build_object('status', 'complete', 'itemCount', 1),
    'cores', jsonb_build_object('status', 'complete', 'itemCount', 1),
    'active_races', jsonb_build_object('status', 'complete', 'itemCount', 0),
    'race_fills', jsonb_build_object('status', 'complete', 'itemCount', 0),
    'tokens', jsonb_build_object('status', 'complete', 'itemCount', 1),
    'splice_arena', jsonb_build_object('status', 'complete', 'itemCount', 0)
  );
  v_status text;
  v_read jsonb;
BEGIN
  v_status := dna.stage_dna_open_lab_sync_candidate(
    '76000000-0000-4000-8000-000000000001', v_generation_id,
    '2026-08-28T12:01:00.000Z', '2026-08-28T12:02:00.000Z', v_families
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'synthetic evidence-index generation was not staged';
  END IF;

  BEGIN
    PERFORM dna.publish_dna_open_lab_indexed_sync_candidate(
      '76000000-0000-4000-8000-000000000001', v_generation_id,
      '2026-08-28T12:03:00.000Z'
    );
    RAISE EXCEPTION 'generation published without its evidence index';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'generation published without its evidence index' THEN RAISE; END IF;
  END;

  v_status := dna.save_dna_open_lab_current_state_evidence_index(
    '76000000-0000-4000-8000-000000000001', v_generation_id, v_index,
    '2026-08-28T12:02:00.000Z'
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'current-state evidence index was not bound to staging';
  END IF;
  v_status := dna.save_dna_open_lab_current_state_evidence_index(
    '76000000-0000-4000-8000-000000000001', v_generation_id, v_index,
    '2026-08-28T12:02:00.000Z'
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'current-state evidence index replay was not idempotent';
  END IF;

  BEGIN
    PERFORM dna.save_dna_open_lab_current_state_evidence_index(
      '76000000-0000-4000-8000-000000000001', v_generation_id,
      jsonb_set(v_index, '{planSha256}', to_jsonb(repeat('f', 64))),
      '2026-08-28T12:02:00.000Z'
    );
    RAISE EXCEPTION 'conflicting current-state evidence index replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting current-state evidence index replay was accepted' THEN RAISE; END IF;
  END;

  v_status := dna.publish_dna_open_lab_indexed_sync_candidate(
    '76000000-0000-4000-8000-000000000001', v_generation_id,
    '2026-08-28T12:03:00.000Z'
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'indexed generation was not published';
  END IF;
  SELECT receipt_index INTO v_read
  FROM dna.read_dna_open_lab_serving_current_state_evidence_index(
    '76000000-0000-4000-8000-000000000001'
  );
  IF v_read <> v_index THEN
    RAISE EXCEPTION 'serving current-state evidence index is incorrect';
  END IF;

  BEGIN
    PERFORM dna.validate_dna_open_lab_current_state_evidence_index(
      v_generation_id,
      jsonb_set(v_index, '{receipts,1,requestKey}', to_jsonb(repeat('1', 64)))
    );
    RAISE EXCEPTION 'duplicate receipt request key was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'duplicate receipt request key was accepted' THEN RAISE; END IF;
  END;
END
$index_lifecycle$;

SET LOCAL app.owner_id = '76000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_serving_current_state_evidence_index(
      '76000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner current-state evidence index was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner current-state evidence index was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('77000000-0000-4000-8000-000000000001', 'synthetic_recovery_fingerprint_owner'),
  ('77000000-0000-4000-8000-000000000002', 'synthetic_recovery_fingerprint_other');

DO $privileges$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.read_dna_open_lab_p5_recovery_fingerprints(uuid)',
    'EXECUTE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_sync_generation', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_finished_race_backfill_checkpoint', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_current_state_evidence_index', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'P5 recovery fingerprint runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '77000000-0000-4000-8000-000000000001';

DO $fingerprints$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT jsonb_object_agg(evidence_group, jsonb_build_object(
    'row_count', row_count,
    'fingerprint_payload', fingerprint_payload
  )) INTO v_before
  FROM dna.read_dna_open_lab_p5_recovery_fingerprints(
    '77000000-0000-4000-8000-000000000001'
  );

  IF jsonb_object_length(v_before) <> 4
     OR NOT (v_before ?& ARRAY[
       'owner_data', 'checkpoint_state', 'serving_state', 'retained_evidence'
     ]) THEN
    RAISE EXCEPTION 'P5 recovery fingerprint group coverage is incomplete';
  END IF;

  INSERT INTO dna.dna_open_lab_finished_race_backfill_checkpoint (
    owner_id, revision, checkpoint, updated_at
  ) VALUES (
    '77000000-0000-4000-8000-000000000001', 1, '{}'::jsonb,
    '2026-08-31T00:00:00.000Z'
  );

  SELECT jsonb_object_agg(evidence_group, jsonb_build_object(
    'row_count', row_count,
    'fingerprint_payload', fingerprint_payload
  )) INTO v_after
  FROM dna.read_dna_open_lab_p5_recovery_fingerprints(
    '77000000-0000-4000-8000-000000000001'
  );

  IF v_after -> 'checkpoint_state' = v_before -> 'checkpoint_state'
     OR v_after -> 'owner_data' <> v_before -> 'owner_data'
     OR v_after -> 'serving_state' <> v_before -> 'serving_state'
     OR v_after -> 'retained_evidence' <> v_before -> 'retained_evidence'
     OR (v_after #>> '{checkpoint_state,row_count}')::bigint <> 1 THEN
    RAISE EXCEPTION 'P5 recovery fingerprints do not isolate state groups';
  END IF;
END
$fingerprints$;

SET LOCAL app.owner_id = '77000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_p5_recovery_fingerprints(
      '77000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner P5 recovery fingerprints were readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner P5 recovery fingerprints were readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

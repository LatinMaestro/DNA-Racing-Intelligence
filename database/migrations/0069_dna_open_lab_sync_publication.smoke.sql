BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('69000000-0000-4000-8000-000000000001', 'synthetic_api_sync_owner'),
  ('69000000-0000-4000-8000-000000000002', 'synthetic_api_sync_other');

SET LOCAL app.owner_id = '69000000-0000-4000-8000-000000000001';

DO $partial_guard$
DECLARE
  v_status text;
BEGIN
  v_status := dna.stage_dna_open_lab_sync_candidate(
    '69000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000101',
    '2026-08-27T12:00:00Z', '2026-08-27T12:01:00Z',
    '{
      "vault":{"status":"complete","itemCount":2},
      "cores":{"status":"complete","itemCount":2},
      "active_races":{"status":"partial","itemCount":1},
      "race_fills":{"status":"complete","itemCount":1},
      "tokens":{"status":"complete","itemCount":2},
      "splice_arena":{"status":"complete","itemCount":3}
    }'::jsonb
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'DNA Open Lab candidate was not staged';
  END IF;
  BEGIN
    PERFORM dna.publish_dna_open_lab_sync_candidate(
      '69000000-0000-4000-8000-000000000001',
      '69000000-0000-4000-8000-000000000101',
      '2026-08-27T12:02:00Z'
    );
    RAISE EXCEPTION 'partial DNA Open Lab candidate was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'partial DNA Open Lab candidate was published' THEN RAISE; END IF;
  END;
END
$partial_guard$;

DO $publish$
DECLARE
  v_status text;
  v_state dna.dna_open_lab_sync_state%ROWTYPE;
BEGIN
  v_status := dna.stage_dna_open_lab_sync_candidate(
    '69000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000101',
    '2026-08-27T12:00:00Z', '2026-08-27T12:01:00Z',
    '{
      "vault":{"status":"complete","itemCount":2},
      "cores":{"status":"complete","itemCount":2},
      "active_races":{"status":"complete","itemCount":1},
      "race_fills":{"status":"complete","itemCount":1},
      "tokens":{"status":"complete","itemCount":2},
      "splice_arena":{"status":"complete","itemCount":3}
    }'::jsonb
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'DNA Open Lab complete candidate was not restaged';
  END IF;
  v_status := dna.publish_dna_open_lab_sync_candidate(
    '69000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000101',
    '2026-08-27T12:02:00Z'
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'DNA Open Lab candidate was not published';
  END IF;
  SELECT state.* INTO v_state FROM dna.read_dna_open_lab_sync_state(
    '69000000-0000-4000-8000-000000000001'
  ) state;
  IF v_state.accepted_generation_id <>
       '69000000-0000-4000-8000-000000000101'::uuid
     OR v_state.serving_generation_id <> v_state.accepted_generation_id
     OR v_state.sync_status <> 'current'
     OR v_state.catch_up_required
     OR v_state.revision <> 1 THEN
    RAISE EXCEPTION 'DNA Open Lab last-good state is incorrect';
  END IF;
END
$publish$;

DO $pause_and_replay$
DECLARE
  v_status text;
  v_state dna.dna_open_lab_sync_state%ROWTYPE;
BEGIN
  v_status := dna.pause_dna_open_lab_sync(
    '69000000-0000-4000-8000-000000000001',
    'rate_limited', '2026-08-27T12:03:00Z', 60
  );
  IF v_status <> 'paused' THEN RAISE EXCEPTION 'API sync was not paused'; END IF;
  SELECT state.* INTO v_state FROM dna.read_dna_open_lab_sync_state(
    '69000000-0000-4000-8000-000000000001'
  ) state;
  IF v_state.serving_generation_id <>
       '69000000-0000-4000-8000-000000000101'::uuid
     OR v_state.sync_status <> 'paused'
     OR NOT v_state.catch_up_required
     OR v_state.retry_after_seconds <> 60 THEN
    RAISE EXCEPTION 'API pause replaced last-good state';
  END IF;

  v_status := dna.stage_dna_open_lab_sync_candidate(
    '69000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000101',
    '2026-08-27T12:00:00Z', '2026-08-27T12:04:00Z',
    '{
      "vault":{"status":"complete","itemCount":2},
      "cores":{"status":"complete","itemCount":2},
      "active_races":{"status":"complete","itemCount":1},
      "race_fills":{"status":"complete","itemCount":1},
      "tokens":{"status":"complete","itemCount":2},
      "splice_arena":{"status":"complete","itemCount":3}
    }'::jsonb
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'published generation replay was not idempotent';
  END IF;
END
$pause_and_replay$;

SET LOCAL app.owner_id = '69000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_sync_state(
      '69000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner API state was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner API state was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

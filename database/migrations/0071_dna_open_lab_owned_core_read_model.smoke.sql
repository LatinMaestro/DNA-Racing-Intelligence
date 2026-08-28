BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('71000000-0000-4000-8000-000000000001', 'synthetic_api_core_owner'),
  ('71000000-0000-4000-8000-000000000002', 'synthetic_api_core_other');

SET LOCAL app.owner_id = '71000000-0000-4000-8000-000000000001';

DO $guards$
DECLARE
  v_count bigint;
BEGIN
  IF has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_materialized_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb)',
    'EXECUTE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_owned_core_snapshot', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'DNA Open Lab owned Core runtime grants are unsafe';
  END IF;

  BEGIN
    PERFORM dna.stage_dna_open_lab_materialized_candidate(
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000101',
      '2026-08-28T00:00:00Z', '2026-08-28T00:01:00Z',
      '{
        "vault":{"status":"complete","itemCount":1},
        "cores":{"status":"complete","itemCount":2},
        "active_races":{"status":"complete","itemCount":0},
        "race_fills":{"status":"complete","itemCount":0},
        "tokens":{"status":"complete","itemCount":1},
        "splice_arena":{"status":"complete","itemCount":0}
      }'::jsonb,
      '[{
        "sourceCoreId":"101","displayName":"Synthetic Alpha",
        "coreClass":"Genesis","element":"Metal","fNumber":1,
        "sex":"female","colorSourceValue":null,
        "observedAt":"2026-08-27T23:59:00Z",
        "rawEvidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }]'::jsonb
    );
    RAISE EXCEPTION 'mismatched owned Core count was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'mismatched owned Core count was accepted' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_count
  FROM dna.dna_open_lab_sync_generation
  WHERE owner_id = '71000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rejected owned Core materialization mutated generation state';
  END IF;
END
$guards$;

DO $publish_and_read$
DECLARE
  v_status text;
  v_count bigint;
  v_first record;
BEGIN
  v_status := dna.stage_dna_open_lab_materialized_candidate(
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000101',
    '2026-08-28T00:00:00Z', '2026-08-28T00:01:00Z',
    '{
      "vault":{"status":"complete","itemCount":1},
      "cores":{"status":"complete","itemCount":2},
      "active_races":{"status":"complete","itemCount":0},
      "race_fills":{"status":"complete","itemCount":0},
      "tokens":{"status":"complete","itemCount":1},
      "splice_arena":{"status":"complete","itemCount":0}
    }'::jsonb,
    '[
      {
        "sourceCoreId":"101","displayName":"Synthetic Alpha",
        "coreClass":"Genesis","element":"Metal","fNumber":1,
        "sex":"female","colorSourceValue":null,
        "observedAt":"2026-08-27T23:59:00Z",
        "rawEvidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      {
        "sourceCoreId":"202","displayName":"Synthetic Beta",
        "coreClass":"Morphed","element":"Fire","fNumber":12,
        "sex":"male","colorSourceValue":"amber",
        "observedAt":"2026-08-27T23:59:30Z",
        "rawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    ]'::jsonb
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'materialized DNA Open Lab candidate was not staged';
  END IF;

  v_status := dna.publish_dna_open_lab_sync_candidate(
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000101',
    '2026-08-28T00:02:00Z'
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'materialized DNA Open Lab candidate was not published';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_serving_owned_cores(
    '71000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'serving owned Core count is incorrect';
  END IF;
  SELECT core.* INTO v_first
  FROM dna.read_dna_open_lab_serving_owned_cores(
    '71000000-0000-4000-8000-000000000001'
  ) core
  ORDER BY core.source_core_id
  LIMIT 1;
  IF v_first.source_core_id <> 101
     OR v_first.display_name <> 'Synthetic Alpha'
     OR v_first.core_class <> 'Genesis'
     OR v_first.element <> 'Metal'
     OR v_first.sex <> 'female'
     OR v_first.color_source_value IS NOT NULL THEN
    RAISE EXCEPTION 'serving owned Core fields are incorrect';
  END IF;
END
$publish_and_read$;

DO $last_good_and_replay$
DECLARE
  v_status text;
  v_count bigint;
BEGIN
  v_status := dna.pause_dna_open_lab_sync(
    '71000000-0000-4000-8000-000000000001',
    'api_unavailable', '2026-08-28T00:03:00Z', NULL
  );
  IF v_status <> 'paused' THEN RAISE EXCEPTION 'sync did not pause'; END IF;
  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_serving_owned_cores(
    '71000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'pause did not retain last-good owned Cores';
  END IF;

  v_status := dna.stage_dna_open_lab_materialized_candidate(
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000101',
    '2026-08-28T00:00:00Z', '2026-08-28T00:04:00Z',
    '{
      "vault":{"status":"complete","itemCount":1},
      "cores":{"status":"complete","itemCount":2},
      "active_races":{"status":"complete","itemCount":0},
      "race_fills":{"status":"complete","itemCount":0},
      "tokens":{"status":"complete","itemCount":1},
      "splice_arena":{"status":"complete","itemCount":0}
    }'::jsonb,
    '[
      {
        "sourceCoreId":"101","displayName":"Synthetic Alpha",
        "coreClass":"Genesis","element":"Metal","fNumber":1,
        "sex":"female","colorSourceValue":null,
        "observedAt":"2026-08-27T23:59:00Z",
        "rawEvidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      {
        "sourceCoreId":"202","displayName":"Synthetic Beta",
        "coreClass":"Morphed","element":"Fire","fNumber":12,
        "sex":"male","colorSourceValue":"amber",
        "observedAt":"2026-08-27T23:59:30Z",
        "rawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    ]'::jsonb
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'materialized publication replay was not idempotent';
  END IF;
END
$last_good_and_replay$;

SET LOCAL app.owner_id = '71000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_serving_owned_cores(
      '71000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner owned Core snapshot was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner owned Core snapshot was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

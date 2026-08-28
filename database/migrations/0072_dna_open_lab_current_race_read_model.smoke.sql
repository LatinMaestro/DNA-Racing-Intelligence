BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('72000000-0000-4000-8000-000000000001', 'synthetic_current_race_owner'),
  ('72000000-0000-4000-8000-000000000002', 'synthetic_current_race_other');

SET LOCAL app.owner_id = '72000000-0000-4000-8000-000000000001';

DO $guards$
DECLARE
  v_count bigint;
BEGIN
  IF has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_materialized_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_active_race_snapshot', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_race_fill_snapshot', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'DNA Open Lab current-race runtime grants are unsafe';
  END IF;

  BEGIN
    PERFORM dna.stage_dna_open_lab_current_race_candidate(
      '72000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000201',
      '2026-08-28T01:00:00Z', '2026-08-28T01:01:00Z',
      '{
        "vault":{"status":"complete","itemCount":0},
        "cores":{"status":"complete","itemCount":0},
        "active_races":{"status":"complete","itemCount":2},
        "race_fills":{"status":"complete","itemCount":1},
        "tokens":{"status":"complete","itemCount":0},
        "splice_arena":{"status":"complete","itemCount":0}
      }'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    );
    RAISE EXCEPTION 'mismatched current-race count was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'mismatched current-race count was accepted' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_count FROM dna.dna_open_lab_sync_generation
  WHERE owner_id = '72000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rejected current-race materialization mutated generation state';
  END IF;
END
$guards$;

DO $stage_publish_read$
DECLARE
  v_status text;
  v_count bigint;
  v_first record;
  v_families jsonb := '{
    "vault":{"status":"complete","itemCount":0},
    "cores":{"status":"complete","itemCount":0},
    "active_races":{"status":"complete","itemCount":2},
    "race_fills":{"status":"complete","itemCount":1},
    "tokens":{"status":"complete","itemCount":0},
    "splice_arena":{"status":"complete","itemCount":0}
  }'::jsonb;
  v_active jsonb := '[
    {
      "sourceRaceId":"race-100","observedAt":"2026-08-28T00:59:00Z",
      "rawEvidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "canonical":{
        "sourceType":"active_race_snapshot","sourceRaceId":"race-100",
        "status":"open","displayName":"Synthetic Sprint","mode":"bike",
        "format":"normal","raceClassSourceValue":3,
        "fixedFeesByAsset":{"DEZ":0.25},"entryFeeUsd":2.5,
        "paymentAsset":"DEZ","startAt":null,"endAt":null
      }
    },
    {
      "sourceRaceId":"race-200","observedAt":"2026-08-28T00:59:30Z",
      "rawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "canonical":{
        "sourceType":"active_race_snapshot","sourceRaceId":"race-200",
        "status":"filling","displayName":"Synthetic Distance","mode":"horse",
        "format":null,"raceClassSourceValue":"open",
        "fixedFeesByAsset":{},"entryFeeUsd":0,
        "paymentAsset":"DEZ","startAt":"2026-08-28T02:00:00Z","endAt":null
      }
    }
  ]'::jsonb;
  v_fills jsonb := '[{
    "sourceRaceId":"race-200","observedAt":"2026-08-28T00:59:45Z",
    "rawEvidenceSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "canonical":{
      "sourceType":"race_fill_snapshot","sourceRaceId":"race-200",
      "status":"filling","gateCount":8,"filledGateCount":2,
      "entrantCoreIds":["101","202"],
      "entryConfirmationsBySourceKey":{"101":true,"202":false}
    }
  }]'::jsonb;
BEGIN
  BEGIN
    PERFORM dna.stage_dna_open_lab_current_race_candidate(
      '72000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000201',
      '2026-08-28T01:00:00Z', '2026-08-28T01:01:00Z', v_families,
      '[]'::jsonb, v_active,
      jsonb_set(
        jsonb_set(v_fills, '{0,sourceRaceId}', '"race-orphan"'::jsonb),
        '{0,canonical,sourceRaceId}', '"race-orphan"'::jsonb
      )
    );
    RAISE EXCEPTION 'orphan race fill was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'orphan race fill was accepted' THEN RAISE; END IF;
  END;

  v_status := dna.stage_dna_open_lab_current_race_candidate(
    '72000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000201',
    '2026-08-28T01:00:00Z', '2026-08-28T01:01:00Z', v_families,
    '[]'::jsonb, v_active, v_fills
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'current-race candidate was not staged';
  END IF;

  BEGIN
    DELETE FROM dna.dna_open_lab_race_fill_snapshot
    WHERE owner_id = '72000000-0000-4000-8000-000000000001'
      AND generation_id = '72000000-0000-4000-8000-000000000201';
    DELETE FROM dna.dna_open_lab_active_race_snapshot
    WHERE owner_id = '72000000-0000-4000-8000-000000000001'
      AND generation_id = '72000000-0000-4000-8000-000000000201';
    PERFORM dna.publish_dna_open_lab_sync_candidate(
      '72000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000201', '2026-08-28T01:02:00Z'
    );
    RAISE EXCEPTION 'incomplete current-race materialization was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete current-race materialization was published' THEN RAISE; END IF;
  END;

  v_status := dna.publish_dna_open_lab_sync_candidate(
    '72000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000201', '2026-08-28T01:02:00Z'
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'current-race candidate was not published';
  END IF;

  SELECT count(*) INTO v_count FROM dna.read_dna_open_lab_serving_active_races(
    '72000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 2 THEN RAISE EXCEPTION 'serving active-race count is wrong'; END IF;
  SELECT race.* INTO v_first FROM dna.read_dna_open_lab_serving_active_races(
    '72000000-0000-4000-8000-000000000001'
  ) race ORDER BY race.source_race_id LIMIT 1;
  IF v_first.source_race_id <> 'race-100'
     OR v_first.canonical ->> 'mode' <> 'bike'
     OR v_first.canonical ? 'distance' THEN
    RAISE EXCEPTION 'serving active-race fields are wrong';
  END IF;
  SELECT count(*) INTO v_count FROM dna.read_dna_open_lab_serving_race_fills(
    '72000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 1 THEN RAISE EXCEPTION 'serving race-fill count is wrong'; END IF;

  v_status := dna.stage_dna_open_lab_current_race_candidate(
    '72000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000201',
    '2026-08-28T01:00:00Z', '2026-08-28T01:03:00Z', v_families,
    '[]'::jsonb, v_active, v_fills
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'current-race publication replay was not idempotent';
  END IF;
END
$stage_publish_read$;

DO $last_good$
DECLARE
  v_status text;
  v_count bigint;
BEGIN
  v_status := dna.pause_dna_open_lab_sync(
    '72000000-0000-4000-8000-000000000001',
    'rate_limited', '2026-08-28T01:04:00Z', 60
  );
  IF v_status <> 'paused' THEN RAISE EXCEPTION 'sync did not pause'; END IF;
  SELECT count(*) INTO v_count FROM dna.read_dna_open_lab_serving_active_races(
    '72000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'pause did not retain last-good active races';
  END IF;
END
$last_good$;

SET LOCAL app.owner_id = '72000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_serving_active_races(
      '72000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner active-race snapshot was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner active-race snapshot was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

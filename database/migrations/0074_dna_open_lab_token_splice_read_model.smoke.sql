BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('74000000-0000-4000-8000-000000000001', 'synthetic_token_splice_owner'),
  ('74000000-0000-4000-8000-000000000002', 'synthetic_token_splice_other');

SET LOCAL app.owner_id = '74000000-0000-4000-8000-000000000001';

DO $guards$
DECLARE
  v_count bigint;
  v_families jsonb := '{
    "vault":{"status":"complete","itemCount":1},
    "cores":{"status":"complete","itemCount":0},
    "active_races":{"status":"complete","itemCount":0},
    "race_fills":{"status":"complete","itemCount":0},
    "tokens":{"status":"complete","itemCount":1},
    "splice_arena":{"status":"complete","itemCount":2}
  }'::jsonb;
  v_supplemental jsonb := '{
    "racingStats":[],"power":[],"listings":[],"attachedAssets":[],
    "owners":[],"stamina":[],"splicing":[]
  }'::jsonb;
  v_payload jsonb := '{
    "tokenPrices":{
      "observedAt":"2026-08-28T08:59:00Z",
      "rawEvidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "canonical":{
        "sourceType":"token_prices_snapshot",
        "valuationUse":"current_reference_only",
        "usdReferencePriceByAsset":{
          "ETH":3200,"BTC":95000,"DEZ":0.1,"HLX":0.2,
          "BGC":1,"TP":0.3,"METH":32,"MBTC":950
        }
      }
    },
    "arenaModes":["bike"],
    "arenaPages":[{
      "mode":"bike","page":1,"observedAt":"2026-08-28T08:58:00Z",
      "rawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "canonical":{
        "sourceType":"splice_arena_page_snapshot","mode":"bike","page":1,
        "pageSizeLimit":20,"hasMore":false,
        "listings":[
          {"sourceCoreId":"101","displayName":"Synthetic One","coreTypeSourceValue":"Pacer","genderSourceValue":"Female","elementSourceValue":"Fire","colorSourceValue":"Red","hexColorSourceValue":"#ff0000","fNumber":4,"priceUsdSourceValue":10.1},
          {"sourceCoreId":"202","displayName":"Synthetic Two","coreTypeSourceValue":"Pacer","genderSourceValue":"Male","elementSourceValue":"Earth","colorSourceValue":"Brown","hexColorSourceValue":"#654321","fNumber":5,"priceUsdSourceValue":20.2}
        ]
      }
    }],
    "arenaListings":[
      {"mode":"bike","sourceCoreId":"101","page":1,"pageObservedAt":"2026-08-28T08:58:00Z","pageRawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","canonical":{"sourceCoreId":"101","displayName":"Synthetic One","coreTypeSourceValue":"Pacer","genderSourceValue":"Female","elementSourceValue":"Fire","colorSourceValue":"Red","hexColorSourceValue":"#ff0000","fNumber":4,"priceUsdSourceValue":10.1}},
      {"mode":"bike","sourceCoreId":"202","page":1,"pageObservedAt":"2026-08-28T08:58:00Z","pageRawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","canonical":{"sourceCoreId":"202","displayName":"Synthetic Two","coreTypeSourceValue":"Pacer","genderSourceValue":"Male","elementSourceValue":"Earth","colorSourceValue":"Brown","hexColorSourceValue":"#654321","fNumber":5,"priceUsdSourceValue":20.2}}
    ]
  }'::jsonb;
BEGIN
  IF has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_supplemental_core_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_token_splice_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_token_prices_snapshot', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_splice_arena_listing_snapshot', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'DNA Open Lab Token/Splice runtime grants are unsafe';
  END IF;

  BEGIN
    PERFORM dna.stage_dna_open_lab_token_splice_candidate(
      '74000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000301',
      '2026-08-28T09:00:00Z', '2026-08-28T09:01:00Z',
      v_families, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      v_supplemental,
      jsonb_set(v_payload, '{arenaPages,0,canonical,hasMore}', 'true'::jsonb)
    );
    RAISE EXCEPTION 'non-terminal Arena crawl was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'non-terminal Arena crawl was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.stage_dna_open_lab_token_splice_candidate(
      '74000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000301',
      '2026-08-28T09:00:00Z', '2026-08-28T09:01:00Z',
      v_families, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      v_supplemental,
      v_payload #- '{tokenPrices,canonical,usdReferencePriceByAsset,ETH}'
    );
    RAISE EXCEPTION 'incomplete Token asset set was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete Token asset set was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.stage_dna_open_lab_token_splice_candidate(
      '74000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000301',
      '2026-08-28T09:00:00Z', '2026-08-28T09:01:00Z',
      v_families, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      v_supplemental,
      jsonb_set(v_payload, '{arenaListings,1,sourceCoreId}', '"101"'::jsonb)
    );
    RAISE EXCEPTION 'duplicate Arena mode/Core was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'duplicate Arena mode/Core was accepted' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_count FROM dna.dna_open_lab_sync_generation
  WHERE owner_id = '74000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rejected Token/Splice payload mutated generation state';
  END IF;
END
$guards$;

DO $stage_publish_read$
DECLARE
  v_status text;
  v_count bigint;
  v_token record;
  v_page record;
  v_families jsonb := '{
    "vault":{"status":"complete","itemCount":1},
    "cores":{"status":"complete","itemCount":0},
    "active_races":{"status":"complete","itemCount":0},
    "race_fills":{"status":"complete","itemCount":0},
    "tokens":{"status":"complete","itemCount":1},
    "splice_arena":{"status":"complete","itemCount":2}
  }'::jsonb;
  v_supplemental jsonb := '{"racingStats":[],"power":[],"listings":[],"attachedAssets":[],"owners":[],"stamina":[],"splicing":[]}'::jsonb;
  v_payload jsonb := '{
    "tokenPrices":{"observedAt":"2026-08-28T08:59:00Z","rawEvidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","canonical":{"sourceType":"token_prices_snapshot","valuationUse":"current_reference_only","usdReferencePriceByAsset":{"ETH":3200,"BTC":95000,"DEZ":0.1,"HLX":0.2,"BGC":1,"TP":0.3,"METH":32,"MBTC":950}}},
    "arenaModes":["bike"],
    "arenaPages":[{"mode":"bike","page":1,"observedAt":"2026-08-28T08:58:00Z","rawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","canonical":{"sourceType":"splice_arena_page_snapshot","mode":"bike","page":1,"pageSizeLimit":20,"hasMore":false,"listings":[{"sourceCoreId":"101","displayName":"Synthetic One","coreTypeSourceValue":"Pacer","genderSourceValue":"Female","elementSourceValue":"Fire","colorSourceValue":"Red","hexColorSourceValue":"#ff0000","fNumber":4,"priceUsdSourceValue":10.1},{"sourceCoreId":"202","displayName":"Synthetic Two","coreTypeSourceValue":"Pacer","genderSourceValue":"Male","elementSourceValue":"Earth","colorSourceValue":"Brown","hexColorSourceValue":"#654321","fNumber":5,"priceUsdSourceValue":20.2}]}}],
    "arenaListings":[{"mode":"bike","sourceCoreId":"101","page":1,"pageObservedAt":"2026-08-28T08:58:00Z","pageRawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","canonical":{"sourceCoreId":"101","displayName":"Synthetic One","coreTypeSourceValue":"Pacer","genderSourceValue":"Female","elementSourceValue":"Fire","colorSourceValue":"Red","hexColorSourceValue":"#ff0000","fNumber":4,"priceUsdSourceValue":10.1}},{"mode":"bike","sourceCoreId":"202","page":1,"pageObservedAt":"2026-08-28T08:58:00Z","pageRawEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","canonical":{"sourceCoreId":"202","displayName":"Synthetic Two","coreTypeSourceValue":"Pacer","genderSourceValue":"Male","elementSourceValue":"Earth","colorSourceValue":"Brown","hexColorSourceValue":"#654321","fNumber":5,"priceUsdSourceValue":20.2}}]
  }'::jsonb;
BEGIN
  v_status := dna.stage_dna_open_lab_token_splice_candidate(
    '74000000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000301',
    '2026-08-28T09:00:00Z', '2026-08-28T09:01:00Z',
    v_families, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    v_supplemental, v_payload
  );
  IF v_status <> 'staged' THEN RAISE EXCEPTION 'Token/Splice candidate was not staged'; END IF;

  BEGIN
    DELETE FROM dna.dna_open_lab_splice_arena_listing_snapshot
    WHERE owner_id = '74000000-0000-4000-8000-000000000001'
      AND generation_id = '74000000-0000-4000-8000-000000000301'
      AND source_core_id = 202;
    PERFORM dna.publish_dna_open_lab_sync_candidate(
      '74000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000301', '2026-08-28T09:02:00Z'
    );
    RAISE EXCEPTION 'incomplete Arena materialization was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete Arena materialization was published' THEN RAISE; END IF;
  END;

  v_status := dna.publish_dna_open_lab_sync_candidate(
    '74000000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000301', '2026-08-28T09:02:00Z'
  );
  IF v_status <> 'published' THEN RAISE EXCEPTION 'Token/Splice candidate was not published'; END IF;

  SELECT * INTO v_token FROM dna.read_dna_open_lab_serving_token_prices(
    '74000000-0000-4000-8000-000000000001'
  );
  IF v_token.canonical -> 'usdReferencePriceByAsset' ->> 'ETH' <> '3200' THEN
    RAISE EXCEPTION 'serving Token price is wrong';
  END IF;
  SELECT count(*) INTO v_count FROM dna.read_dna_open_lab_serving_splice_arena(
    '74000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 2 THEN RAISE EXCEPTION 'serving Arena listing count is wrong'; END IF;
  SELECT * INTO v_page FROM dna.read_dna_open_lab_serving_splice_arena_pages(
    '74000000-0000-4000-8000-000000000001'
  );
  IF v_page.mode <> 'bike' OR v_page.page <> 1
     OR v_page.has_more OR v_page.listing_count <> 2 THEN
    RAISE EXCEPTION 'serving Arena page receipt is wrong';
  END IF;

  v_status := dna.stage_dna_open_lab_token_splice_candidate(
    '74000000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000301',
    '2026-08-28T09:00:00Z', '2026-08-28T09:03:00Z',
    v_families, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    v_supplemental, v_payload
  );
  IF v_status <> 'published' THEN RAISE EXCEPTION 'Token/Splice replay was not idempotent'; END IF;

  BEGIN
    PERFORM dna.stage_dna_open_lab_token_splice_candidate(
      '74000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000301',
      '2026-08-28T09:00:00Z', '2026-08-28T09:04:00Z',
      v_families, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      v_supplemental,
      jsonb_set(v_payload, '{tokenPrices,canonical,usdReferencePriceByAsset,ETH}', '3201'::jsonb)
    );
    RAISE EXCEPTION 'conflicting Token replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting Token replay was accepted' THEN RAISE; END IF;
  END;
END
$stage_publish_read$;

DO $last_good$
DECLARE
  v_status text;
  v_count bigint;
BEGIN
  v_status := dna.pause_dna_open_lab_sync(
    '74000000-0000-4000-8000-000000000001',
    'rate_limited', '2026-08-28T09:05:00Z', 60
  );
  IF v_status <> 'paused' THEN RAISE EXCEPTION 'sync did not pause'; END IF;
  SELECT count(*) INTO v_count FROM dna.read_dna_open_lab_serving_splice_arena(
    '74000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 2 THEN RAISE EXCEPTION 'pause did not retain last-good Arena state'; END IF;
END
$last_good$;

SET LOCAL app.owner_id = '74000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_serving_token_prices(
      '74000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner Token snapshot was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Token snapshot was readable' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_serving_splice_arena(
      '74000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner Arena snapshot was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Arena snapshot was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

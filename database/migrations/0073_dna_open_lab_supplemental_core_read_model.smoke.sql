BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('73000000-0000-4000-8000-000000000001', 'synthetic_supplemental_core_owner'),
  ('73000000-0000-4000-8000-000000000002', 'synthetic_supplemental_core_other');

SET LOCAL app.owner_id = '73000000-0000-4000-8000-000000000001';

DO $guards$
DECLARE
  v_count bigint;
  v_families jsonb := '{
    "vault":{"status":"complete","itemCount":1},
    "cores":{"status":"complete","itemCount":1},
    "active_races":{"status":"complete","itemCount":0},
    "race_fills":{"status":"complete","itemCount":0},
    "tokens":{"status":"complete","itemCount":0},
    "splice_arena":{"status":"complete","itemCount":0}
  }'::jsonb;
  v_owned jsonb := '[{
    "sourceCoreId":"101","displayName":"Synthetic Bike Core",
    "coreClass":"Morphed","element":"Fire","fNumber":12,"sex":"female",
    "colorSourceValue":null,"observedAt":"2026-08-28T06:59:00Z",
    "rawEvidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }]'::jsonb;
  v_supplemental jsonb := '{
    "racingStats":[{
      "sourceCoreId":"101","observedAt":"2026-08-28T06:58:00Z",
      "rawEvidenceSha256":"1111111111111111111111111111111111111111111111111111111111111111",
      "canonical":{"sourceType":"core_racing_stats_snapshot","sourceCoreId":"101","statsByMode":{"bike":{},"car":null,"horse":null},"ageingSourceValue":null,"isMaiden":false,"tournamentProfitsSourceValue":0}
    }],
    "power":[{
      "sourceCoreId":"101","observedAt":"2026-08-28T06:58:01Z",
      "rawEvidenceSha256":"2222222222222222222222222222222222222222222222222222222222222222",
      "canonical":{"sourceType":"core_power_snapshot","sourceCoreId":"101","byMode":{"bike":{"powerSourceValue":80,"adjustedOddsSourceValue":null,"varianceSourceValue":4,"raceCount":7},"car":{"powerSourceValue":null,"adjustedOddsSourceValue":null,"varianceSourceValue":null,"raceCount":0},"horse":{"powerSourceValue":null,"adjustedOddsSourceValue":null,"varianceSourceValue":null,"raceCount":0}},"aggregateStatsSourceValue":{}}
    }],
    "listings":[{
      "sourceCoreId":"101","observedAt":"2026-08-28T06:58:02Z",
      "rawEvidenceSha256":"3333333333333333333333333333333333333333333333333333333333333333",
      "canonical":{"sourceType":"core_listing_snapshot","sourceCoreId":"101"}
    }],
    "attachedAssets":[{
      "sourceCoreId":"101","observedAt":"2026-08-28T06:58:03Z",
      "rawEvidenceSha256":"4444444444444444444444444444444444444444444444444444444444444444",
      "canonical":{"sourceType":"core_attached_assets_snapshot","sourceCoreId":"101","skinSourceValueByMode":{"bike":null,"car":null,"horse":null},"trailsSourceValue":[]}
    }],
    "owners":[{
      "sourceCoreId":"101","observedAt":"2026-08-28T06:58:04Z",
      "rawEvidenceSha256":"5555555555555555555555555555555555555555555555555555555555555555",
      "canonical":{"sourceType":"core_owner_snapshot","sourceCoreId":"101","vaultSourceValue":"0xsynthetic-public-vault"}
    }],
    "stamina":[{
      "sourceCoreId":"101","observedAt":"2026-08-28T06:58:05Z",
      "rawEvidenceSha256":"6666666666666666666666666666666666666666666666666666666666666666",
      "canonical":{"sourceType":"core_stamina_snapshot","sourceCoreId":"101","current":8,"maximum":10,"nextRefillAt":null,"lastEventAt":null,"special":null}
    }],
    "splicing":[{
      "sourceCoreId":"101","observedAt":"2026-08-28T06:58:06Z",
      "rawEvidenceSha256":"7777777777777777777777777777777777777777777777777777777777777777",
      "canonical":{"sourceType":"core_splicing_snapshot","sourceCoreId":"101","parentsSourceValue":null,"grandparentsSourceValue":null,"challengeCreditSourceValue":0,"spliceCoreSourceValue":null}
    }]
  }'::jsonb;
BEGIN
  IF has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.stage_dna_open_lab_supplemental_core_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_core_supplemental_snapshot', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'DNA Open Lab supplemental Core runtime grants are unsafe';
  END IF;

  BEGIN
    PERFORM dna.stage_dna_open_lab_supplemental_core_candidate(
      '73000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000301',
      '2026-08-28T07:00:00Z', '2026-08-28T07:01:00Z',
      v_families, v_owned, '[]'::jsonb, '[]'::jsonb,
      v_supplemental - 'splicing'
    );
    RAISE EXCEPTION 'incomplete supplemental family set was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete supplemental family set was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.stage_dna_open_lab_supplemental_core_candidate(
      '73000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000301',
      '2026-08-28T07:00:00Z', '2026-08-28T07:01:00Z',
      v_families, v_owned, '[]'::jsonb, '[]'::jsonb,
      jsonb_set(
        jsonb_set(v_supplemental, '{power,0,sourceCoreId}', '"202"'::jsonb),
        '{power,0,canonical,sourceCoreId}', '"202"'::jsonb
      )
    );
    RAISE EXCEPTION 'non-owned supplemental Core was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'non-owned supplemental Core was accepted' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_count FROM dna.dna_open_lab_sync_generation
  WHERE owner_id = '73000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rejected supplemental Core materialization mutated generation state';
  END IF;
END
$guards$;

DO $stage_publish_read$
DECLARE
  v_status text;
  v_count bigint;
  v_first record;
  v_families jsonb := '{
    "vault":{"status":"complete","itemCount":1},
    "cores":{"status":"complete","itemCount":1},
    "active_races":{"status":"complete","itemCount":0},
    "race_fills":{"status":"complete","itemCount":0},
    "tokens":{"status":"complete","itemCount":0},
    "splice_arena":{"status":"complete","itemCount":0}
  }'::jsonb;
  v_owned jsonb := '[{
    "sourceCoreId":"101","displayName":"Synthetic Bike Core",
    "coreClass":"Morphed","element":"Fire","fNumber":12,"sex":"female",
    "colorSourceValue":null,"observedAt":"2026-08-28T06:59:00Z",
    "rawEvidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }]'::jsonb;
  v_supplemental jsonb := '{
    "racingStats":[{"sourceCoreId":"101","observedAt":"2026-08-28T06:58:00Z","rawEvidenceSha256":"1111111111111111111111111111111111111111111111111111111111111111","canonical":{"sourceType":"core_racing_stats_snapshot","sourceCoreId":"101","statsByMode":{"bike":{},"car":null,"horse":null},"ageingSourceValue":null,"isMaiden":false,"tournamentProfitsSourceValue":0}}],
    "power":[{"sourceCoreId":"101","observedAt":"2026-08-28T06:58:01Z","rawEvidenceSha256":"2222222222222222222222222222222222222222222222222222222222222222","canonical":{"sourceType":"core_power_snapshot","sourceCoreId":"101","byMode":{"bike":{"powerSourceValue":80,"adjustedOddsSourceValue":null,"varianceSourceValue":4,"raceCount":7},"car":{"powerSourceValue":null,"adjustedOddsSourceValue":null,"varianceSourceValue":null,"raceCount":0},"horse":{"powerSourceValue":null,"adjustedOddsSourceValue":null,"varianceSourceValue":null,"raceCount":0}},"aggregateStatsSourceValue":{}}}],
    "listings":[{"sourceCoreId":"101","observedAt":"2026-08-28T06:58:02Z","rawEvidenceSha256":"3333333333333333333333333333333333333333333333333333333333333333","canonical":{"sourceType":"core_listing_snapshot","sourceCoreId":"101"}}],
    "attachedAssets":[{"sourceCoreId":"101","observedAt":"2026-08-28T06:58:03Z","rawEvidenceSha256":"4444444444444444444444444444444444444444444444444444444444444444","canonical":{"sourceType":"core_attached_assets_snapshot","sourceCoreId":"101","skinSourceValueByMode":{"bike":null,"car":null,"horse":null},"trailsSourceValue":[]}}],
    "owners":[{"sourceCoreId":"101","observedAt":"2026-08-28T06:58:04Z","rawEvidenceSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonical":{"sourceType":"core_owner_snapshot","sourceCoreId":"101","vaultSourceValue":"0xsynthetic-public-vault"}}],
    "stamina":[{"sourceCoreId":"101","observedAt":"2026-08-28T06:58:05Z","rawEvidenceSha256":"6666666666666666666666666666666666666666666666666666666666666666","canonical":{"sourceType":"core_stamina_snapshot","sourceCoreId":"101","current":8,"maximum":10,"nextRefillAt":null,"lastEventAt":null,"special":null}}],
    "splicing":[{"sourceCoreId":"101","observedAt":"2026-08-28T06:58:06Z","rawEvidenceSha256":"7777777777777777777777777777777777777777777777777777777777777777","canonical":{"sourceType":"core_splicing_snapshot","sourceCoreId":"101","parentsSourceValue":null,"grandparentsSourceValue":null,"challengeCreditSourceValue":0,"spliceCoreSourceValue":null}}]
  }'::jsonb;
BEGIN
  v_status := dna.stage_dna_open_lab_supplemental_core_candidate(
    '73000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000301',
    '2026-08-28T07:00:00Z', '2026-08-28T07:01:00Z',
    v_families, v_owned, '[]'::jsonb, '[]'::jsonb, v_supplemental
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'supplemental Core candidate was not staged';
  END IF;

  BEGIN
    DELETE FROM dna.dna_open_lab_core_supplemental_snapshot
    WHERE owner_id = '73000000-0000-4000-8000-000000000001'
      AND generation_id = '73000000-0000-4000-8000-000000000301'
      AND family = 'power';
    PERFORM dna.publish_dna_open_lab_sync_candidate(
      '73000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000301', '2026-08-28T07:02:00Z'
    );
    RAISE EXCEPTION 'incomplete supplemental Core materialization was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incomplete supplemental Core materialization was published' THEN RAISE; END IF;
  END;

  v_status := dna.publish_dna_open_lab_sync_candidate(
    '73000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000301', '2026-08-28T07:02:00Z'
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'supplemental Core candidate was not published';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_serving_supplemental_cores(
    '73000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'serving supplemental Core family count is wrong';
  END IF;
  SELECT snapshot.* INTO v_first
  FROM dna.read_dna_open_lab_serving_supplemental_cores(
    '73000000-0000-4000-8000-000000000001'
  ) snapshot WHERE snapshot.family = 'power';
  IF v_first.source_core_id <> 101
     OR v_first.canonical -> 'byMode' -> 'bike' ->> 'raceCount' <> '7' THEN
    RAISE EXCEPTION 'serving supplemental Core fields are wrong';
  END IF;

  v_status := dna.stage_dna_open_lab_supplemental_core_candidate(
    '73000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000301',
    '2026-08-28T07:00:00Z', '2026-08-28T07:03:00Z',
    v_families, v_owned, '[]'::jsonb, '[]'::jsonb, v_supplemental
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'supplemental Core publication replay was not idempotent';
  END IF;

  BEGIN
    PERFORM dna.stage_dna_open_lab_supplemental_core_candidate(
      '73000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000301',
      '2026-08-28T07:00:00Z', '2026-08-28T07:04:00Z',
      v_families, v_owned, '[]'::jsonb, '[]'::jsonb,
      jsonb_set(v_supplemental, '{power,0,canonical,byMode,bike,raceCount}', '8'::jsonb)
    );
    RAISE EXCEPTION 'conflicting supplemental Core replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting supplemental Core replay was accepted' THEN RAISE; END IF;
  END;
END
$stage_publish_read$;

DO $last_good$
DECLARE
  v_status text;
  v_count bigint;
BEGIN
  v_status := dna.pause_dna_open_lab_sync(
    '73000000-0000-4000-8000-000000000001',
    'rate_limited', '2026-08-28T07:05:00Z', 60
  );
  IF v_status <> 'paused' THEN RAISE EXCEPTION 'sync did not pause'; END IF;
  SELECT count(*) INTO v_count
  FROM dna.read_dna_open_lab_serving_supplemental_cores(
    '73000000-0000-4000-8000-000000000001'
  );
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'pause did not retain last-good supplemental Core state';
  END IF;
END
$last_good$;

SET LOCAL app.owner_id = '73000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_serving_supplemental_cores(
      '73000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner supplemental Core snapshot was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner supplemental Core snapshot was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

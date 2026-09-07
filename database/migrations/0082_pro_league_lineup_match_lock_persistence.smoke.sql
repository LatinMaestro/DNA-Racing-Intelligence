BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('82000000-0000-4000-8000-000000000001', 'synthetic_lineup_owner'),
  ('82000000-0000-4000-8000-000000000002', 'synthetic_lineup_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
    'dna_app_runtime', 'dna.pro_league_lineup_version', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.pro_league_lineup_entry_snapshot', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.pro_league_match_lock', 'SELECT'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.store_pro_league_lineup_version(uuid,text,integer,text,text,text,text,text,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime', 'dna.read_pro_league_lineup_version(uuid,text)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.store_pro_league_match_lock(uuid,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime', 'dna.read_pro_league_match_lock(uuid,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Pro League lineup runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '82000000-0000-4000-8000-000000000001';

DO $lineup_lifecycle$
DECLARE
  v_owner constant uuid := '82000000-0000-4000-8000-000000000001';
  v_members jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_index integer;
  v_map integer;
  v_disposition text;
  v_count integer;
BEGIN
  FOR v_index IN 1..12 LOOP
    v_members := v_members || jsonb_build_array(jsonb_build_object(
      'coreId', 'core-' || v_index,
      'displayName', 'Core ' || v_index,
      'element', (ARRAY['Metal','Fire','Earth','Water'])[((v_index - 1) % 4) + 1],
      'coreClass', 'Morphed',
      'sex', CASE WHEN v_index <= 4 THEN 'female' ELSE 'male' END,
      'fNumber', CASE WHEN v_index <= 2 THEN 16 ELSE 11 END,
      'inMyVault', true, 'disposition', 'rostered', 'role', 'nucleus',
      'position', v_index, 'reason', 'Synthetic lineup roster.',
      'evidence', jsonb_build_object(
        'asOf', '2026-09-02T23:00:00.000Z',
        'generationId', 'synthetic-generation-1',
        'sha256', repeat('a', 64), 'confidence', 'moderate'
      )
    ));
  END LOOP;
  PERFORM * FROM dna.store_pro_league_roster_version(
    v_owner, 'roster-v1', 1,
    'dna-pro-league/owner-confirmed-2026-08-31',
    'owner-pro-league/ageing-aware-25-core-2026-08-31',
    'unresolved', '2026-09-03T00:00:00Z', 'Synthetic lineup roster.',
    repeat('1', 64), v_members
  );

  FOR v_map IN 1..4 LOOP
    FOR v_index IN 1..42 LOOP
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'mapId', 'map-' || v_map, 'raceNumber', v_index,
        'raceType', '1v1', 'distanceMetres', 1000,
        'totalGateEntries', 2, 'gateEntriesPerVault', 1,
        'coreId', 'core-' || (((v_index - 1) % 12) + 1),
        'sourceRaceNumber', v_index, 'scope', 'single_race'
      ));
    END LOOP;
  END LOOP;
  SELECT stored.disposition, stored.entry_count INTO v_disposition, v_count
  FROM dna.store_pro_league_lineup_version(
    v_owner, 'lineup-v1', 1, 'roster-v1',
    'dna-pro-league/lineup-lock-2026-08-29',
    'dna-pro-league/maps-observed-2026-08-29',
    'Synthetic complete lineup.', repeat('2', 64), v_entries
  ) stored;
  IF (v_disposition, v_count) <> ('created'::text, 168) THEN
    RAISE EXCEPTION 'Pro League lineup was not stored exactly';
  END IF;
  SELECT stored.disposition INTO v_disposition
  FROM dna.store_pro_league_lineup_version(
    v_owner, 'lineup-v1', 1, 'roster-v1',
    'dna-pro-league/lineup-lock-2026-08-29',
    'dna-pro-league/maps-observed-2026-08-29',
    'Synthetic complete lineup.', repeat('2', 64), v_entries
  ) stored;
  IF v_disposition <> 'existing' THEN
    RAISE EXCEPTION 'Pro League lineup replay was not idempotent';
  END IF;
  BEGIN
    PERFORM * FROM dna.store_pro_league_lineup_version(
      v_owner, 'lineup-v1', 1, 'roster-v1',
      'dna-pro-league/lineup-lock-2026-08-29',
      'dna-pro-league/maps-observed-2026-08-29',
      'Synthetic complete lineup.', repeat('3', 64), v_entries
    );
    RAISE EXCEPTION 'conflicting Pro League lineup replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting Pro League lineup replay was accepted' THEN RAISE; END IF;
  END;
  IF (SELECT jsonb_array_length(stored.entries)
      FROM dna.read_pro_league_lineup_version(v_owner, 'lineup-v1') stored) <> 168 THEN
    RAISE EXCEPTION 'Pro League lineup read is incomplete';
  END IF;

  SELECT stored.disposition INTO v_disposition
  FROM dna.store_pro_league_match_lock(
    v_owner, 'lock-1', 'match-1', 'lineup-v1', 'roster-v1',
    'vault-away', 'vault-home', 'vault-away', 'away',
    '2026-09-08T10:00:00Z', '2026-09-08T09:00:00Z',
    'official-match-page/match-1', 'denied_map_excluded',
    'map-1', 'map-4', 'map-2', 'map-3', NULL, NULL, repeat('4', 64)
  ) stored;
  IF v_disposition <> 'created' OR
     (SELECT count(*) FROM dna.read_pro_league_match_lock(v_owner, 'lock-1')) <> 1 THEN
    RAISE EXCEPTION 'Pro League match lock lifecycle is incomplete';
  END IF;
  BEGIN
    PERFORM * FROM dna.store_pro_league_match_lock(
      v_owner, 'lock-2', 'match-2', 'lineup-v1', 'roster-v1',
      'vault-home', 'vault-home', 'vault-away', 'home',
      '2026-09-08T10:00:00Z', '2026-09-08T09:00:00Z',
      'official-match-page/match-2', 'denied_map_excluded',
      'map-1', 'map-4', 'map-2', 'map-4', NULL, NULL, repeat('5', 64)
    );
    RAISE EXCEPTION 'invalid Pro League third map was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid Pro League third map was accepted' THEN RAISE; END IF;
  END;
END
$lineup_lifecycle$;

SET LOCAL app.owner_id = '82000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_pro_league_lineup_version(
      '82000000-0000-4000-8000-000000000001', 'lineup-v1'
    );
    RAISE EXCEPTION 'cross-owner Pro League lineup was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Pro League lineup was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

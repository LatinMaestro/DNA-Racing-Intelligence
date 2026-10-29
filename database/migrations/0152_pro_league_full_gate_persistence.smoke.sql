BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('15200000-0000-4000-8000-000000000001', 'synthetic_full_gate_owner'),
  ('15200000-0000-4000-8000-000000000002', 'synthetic_full_gate_other');

DO $privileges$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.pro_league_full_gate_plan', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.pro_league_full_gate_assignment_snapshot', 'SELECT')
     OR NOT has_function_privilege('dna_app_runtime',
       'dna.store_pro_league_full_gate_plan(uuid,text,text,text,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('dna_app_runtime',
       'dna.read_pro_league_full_gate_plan(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Pro League full-gate runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '15200000-0000-4000-8000-000000000001';

DO $full_gate_lifecycle$
DECLARE
  v_owner constant uuid := '15200000-0000-4000-8000-000000000001';
  v_members jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_map integer;
  v_race integer;
  v_slot integer;
  v_gate integer;
  v_line_index integer := 0;
  v_disposition text;
  v_count integer;
BEGIN
  FOR v_slot IN 1..25 LOOP
    v_members := v_members || jsonb_build_array(jsonb_build_object(
      'coreId', 'core-' || v_slot, 'displayName', 'Core ' || v_slot,
      'element', 'Fire', 'coreClass', 'Morphed',
      'sex', CASE WHEN v_slot <= 8 THEN 'female' ELSE 'male' END,
      'fNumber', 11, 'inMyVault', true, 'disposition', 'rostered',
      'role', 'nucleus', 'position', v_slot,
      'reason', 'Synthetic full-gate roster.',
      'evidence', jsonb_build_object(
        'asOf', '2026-09-16T10:12:20.407Z',
        'generationId', 'synthetic-full-gate-generation',
        'sha256', repeat('a', 64), 'confidence', 'moderate'
      )
    ));
  END LOOP;
  PERFORM * FROM dna.store_pro_league_roster_version(
    v_owner, 'full-gate-roster-v1', 1,
    'dna-pro-league/owner-confirmed-2026-08-31',
    'owner-pro-league/ageing-aware-25-core-2026-08-31',
    'unresolved', '2026-09-16T10:12:20.407Z',
    'Synthetic full-gate roster.', repeat('1', 64), v_members
  );

  FOR v_map IN 1..4 LOOP
    FOR v_race IN 1..42 LOOP
      v_line_index := v_line_index + 1;
      v_gate := CASE WHEN v_line_index <= 13 THEN 7 ELSE 6 END;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'mapId', 'map-' || v_map, 'raceNumber', v_race,
        'raceType', '1v1', 'distanceMetres', 1000,
        'totalGateEntries', v_gate * 2, 'gateEntriesPerVault', v_gate,
        'coreId', 'core-' || (((v_race - 1) % 25) + 1),
        'sourceRaceNumber', v_race, 'scope', 'single_race'
      ));
      FOR v_slot IN 1..v_gate LOOP
        v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
          'mapId', 'map-' || v_map, 'raceNumber', v_race,
          'slotNumber', v_slot, 'raceType', '1v1',
          'distanceMetres', 1000, 'totalGateEntries', v_gate * 2,
          'gateEntriesPerVault', v_gate,
          'coreId', 'core-' || (((v_race + v_slot - 2) % 25) + 1)
        ));
      END LOOP;
    END LOOP;
  END LOOP;
  IF jsonb_array_length(v_assignments) <> 1021 THEN
    RAISE EXCEPTION 'Synthetic full-gate assignment count drifted';
  END IF;
  PERFORM * FROM dna.store_pro_league_lineup_version(
    v_owner, 'full-gate-lineup-v1', 1, 'full-gate-roster-v1',
    'dna-pro-league/lineup-lock-2026-08-29',
    'dna-pro-league/maps-observed-2026-08-29',
    'Synthetic full-gate lineup.', repeat('2', 64), v_lines
  );
  SELECT stored.disposition, stored.assignment_count
    INTO v_disposition, v_count
  FROM dna.store_pro_league_full_gate_plan(
    v_owner, 'full-gate-lineup-v1', 'full-gate-roster-v1',
    'owner-final-roster/full-gate-win-first/2026-09-20',
    repeat('3', 64), v_assignments
  ) stored;
  IF (v_disposition, v_count) <> ('created'::text, 1021) THEN
    RAISE EXCEPTION 'Pro League full-gate plan was not stored exactly';
  END IF;
  SELECT stored.disposition, stored.assignment_count
    INTO v_disposition, v_count
  FROM dna.store_pro_league_full_gate_plan(
    v_owner, 'full-gate-lineup-v1', 'full-gate-roster-v1',
    'owner-final-roster/full-gate-win-first/2026-09-20',
    repeat('3', 64), v_assignments
  ) stored;
  IF (v_disposition, v_count) <> ('existing'::text, 1021) THEN
    RAISE EXCEPTION 'Pro League full-gate replay was not idempotent';
  END IF;
  IF (SELECT stored.assignment_count
      FROM dna.read_pro_league_full_gate_plan(
        v_owner, 'full-gate-lineup-v1'
      ) stored) <> 1021
     OR (SELECT jsonb_array_length(stored.assignments)
         FROM dna.read_pro_league_full_gate_plan(
           v_owner, 'full-gate-lineup-v1'
         ) stored) <> 1021 THEN
    RAISE EXCEPTION 'Pro League full-gate read is incomplete';
  END IF;
  BEGIN
    PERFORM * FROM dna.store_pro_league_full_gate_plan(
      v_owner, 'full-gate-lineup-v1', 'full-gate-roster-v1',
      'owner-final-roster/full-gate-win-first/2026-09-20',
      repeat('4', 64), v_assignments
    );
    RAISE EXCEPTION 'Conflicting Pro League full-gate replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Conflicting Pro League full-gate replay was accepted' THEN RAISE; END IF;
  END;
END
$full_gate_lifecycle$;

SET LOCAL app.owner_id = '15200000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_pro_league_full_gate_plan(
      '15200000-0000-4000-8000-000000000001', 'full-gate-lineup-v1'
    );
    RAISE EXCEPTION 'Cross-owner Pro League full-gate plan was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Cross-owner Pro League full-gate plan was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

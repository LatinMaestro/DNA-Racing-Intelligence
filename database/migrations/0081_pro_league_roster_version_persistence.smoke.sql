BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('80000000-0000-4000-8000-000000000001', 'synthetic_pro_league_owner'),
  ('80000000-0000-4000-8000-000000000002', 'synthetic_pro_league_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
    'dna_app_runtime', 'dna.pro_league_roster_version', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.pro_league_roster_member_snapshot', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.pro_league_roster_substitution', 'SELECT'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.store_pro_league_roster_version(uuid,text,integer,text,text,text,timestamp with time zone,text,text,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.read_pro_league_roster_version(uuid,text)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.record_pro_league_roster_substitution(uuid,integer,integer,text,text,text,text,text,timestamp with time zone,text,text,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.list_pro_league_roster_substitutions(uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Pro League roster runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '80000000-0000-4000-8000-000000000001';

DO $roster_lifecycle$
DECLARE
  v_owner constant uuid := '80000000-0000-4000-8000-000000000001';
  v_members_v1 jsonb := '[]'::jsonb;
  v_members_v2 jsonb := '[]'::jsonb;
  v_member jsonb;
  v_index integer;
  v_disposition text;
  v_rostered integer;
  v_alternates integer;
  v_substitution integer;
BEGIN
  FOR v_index IN 1..13 LOOP
    v_member := jsonb_build_object(
      'coreId', 'core-' || v_index,
      'displayName', 'Core ' || v_index,
      'element', (ARRAY['Metal','Fire','Earth','Water'])[((v_index - 1) % 4) + 1],
      'coreClass', 'Morphed',
      'sex', CASE WHEN v_index <= 4 THEN 'female' ELSE 'male' END,
      'fNumber', CASE WHEN v_index <= 2 THEN 16 ELSE 11 END,
      'inMyVault', true,
      'disposition', CASE WHEN v_index = 13 THEN 'alternate' ELSE 'rostered' END,
      'role', CASE WHEN v_index = 13 THEN 'alternate' ELSE 'nucleus' END,
      'position', CASE WHEN v_index = 13 THEN 1 ELSE v_index END,
      'reason', 'Synthetic exact-format evidence snapshot.',
      'evidence', jsonb_build_object(
        'asOf', '2026-09-02T23:00:00.000Z',
        'generationId', 'synthetic-generation-1',
        'sha256', repeat('a', 64),
        'confidence', 'moderate'
      )
    );
    v_members_v1 := v_members_v1 || jsonb_build_array(v_member);
  END LOOP;

  SELECT stored.disposition, stored.rostered_core_count,
    stored.alternate_core_count
  INTO v_disposition, v_rostered, v_alternates
  FROM dna.store_pro_league_roster_version(
    v_owner, 'roster-v1', 1,
    'dna-pro-league/owner-confirmed-2026-08-31',
    'owner-pro-league/ageing-aware-25-core-2026-08-31',
    'unresolved', '2026-09-03T00:00:00Z',
    'Synthetic quality-first roster.', repeat('1', 64), v_members_v1
  ) stored;
  IF (v_disposition, v_rostered, v_alternates) <>
     ('created'::text, 12, 1) THEN
    RAISE EXCEPTION 'Pro League roster version was not stored exactly';
  END IF;

  SELECT stored.disposition INTO v_disposition
  FROM dna.store_pro_league_roster_version(
    v_owner, 'roster-v1', 1,
    'dna-pro-league/owner-confirmed-2026-08-31',
    'owner-pro-league/ageing-aware-25-core-2026-08-31',
    'unresolved', '2026-09-03T00:00:00Z',
    'Synthetic quality-first roster.', repeat('1', 64), v_members_v1
  ) stored;
  IF v_disposition <> 'existing' THEN
    RAISE EXCEPTION 'Pro League roster version replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.store_pro_league_roster_version(
      v_owner, 'roster-v1', 1,
      'dna-pro-league/owner-confirmed-2026-08-31',
      'owner-pro-league/ageing-aware-25-core-2026-08-31',
      'unresolved', '2026-09-03T00:00:00Z',
      'Synthetic quality-first roster.', repeat('2', 64), v_members_v1
    );
    RAISE EXCEPTION 'conflicting Pro League roster replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting Pro League roster replay was accepted' THEN RAISE; END IF;
  END;

  v_members_v2 := '[]'::jsonb;
  FOR v_index IN 1..12 LOOP
    v_member := jsonb_build_object(
      'coreId', CASE WHEN v_index = 12 THEN 'core-13' ELSE 'core-' || v_index END,
      'displayName', CASE WHEN v_index = 12 THEN 'Core 13' ELSE 'Core ' || v_index END,
      'element', CASE WHEN v_index = 12 THEN 'Metal'
        ELSE (ARRAY['Metal','Fire','Earth','Water'])[((v_index - 1) % 4) + 1]
      END,
      'coreClass', 'Morphed',
      'sex', CASE WHEN v_index <= 4 THEN 'female' ELSE 'male' END,
      'fNumber', CASE WHEN v_index <= 2 THEN 16 ELSE 11 END,
      'inMyVault', true,
      'disposition', 'rostered', 'role', 'nucleus', 'position', v_index,
      'reason', 'Synthetic exact-format evidence snapshot.',
      'evidence', jsonb_build_object(
        'asOf', '2026-09-02T23:30:00.000Z',
        'generationId', 'synthetic-generation-1',
        'sha256', repeat('b', 64),
        'confidence', 'strong'
      )
    );
    v_members_v2 := v_members_v2 || jsonb_build_array(v_member);
  END LOOP;
  PERFORM * FROM dna.store_pro_league_roster_version(
    v_owner, 'roster-v2', 2,
    'dna-pro-league/owner-confirmed-2026-08-31',
    'owner-pro-league/ageing-aware-25-core-2026-08-31',
    'unresolved', '2026-09-03T00:00:00Z',
    'Synthetic single-substitution roster.', repeat('3', 64), v_members_v2
  );

  SELECT stored.substitution_number INTO v_substitution
  FROM dna.record_pro_league_roster_substitution(
    v_owner, 2026, 1, 'roster-v1', 'roster-v2', 'core-12', 'core-13',
    'Synthetic evidence-backed substitution.', '2026-09-02T23:30:00Z',
    'synthetic-generation-1', repeat('c', 64), 'strong', repeat('4', 64)
  ) stored;
  IF v_substitution <> 1 THEN
    RAISE EXCEPTION 'Pro League substitution was not recorded';
  END IF;
  SELECT stored.disposition INTO v_disposition
  FROM dna.record_pro_league_roster_substitution(
    v_owner, 2026, 1, 'roster-v1', 'roster-v2', 'core-12', 'core-13',
    'Synthetic evidence-backed substitution.', '2026-09-02T23:30:00Z',
    'synthetic-generation-1', repeat('c', 64), 'strong', repeat('4', 64)
  ) stored;
  IF v_disposition <> 'existing' THEN
    RAISE EXCEPTION 'Pro League substitution replay was not idempotent';
  END IF;

  IF (SELECT count(*) FROM dna.read_pro_league_roster_version(
    v_owner, 'roster-v2'
  )) <> 1 OR (SELECT count(*) FROM dna.list_pro_league_roster_substitutions(
    v_owner, 2026
  )) <> 1 THEN
    RAISE EXCEPTION 'Pro League roster persistence read contract is incomplete';
  END IF;
END
$roster_lifecycle$;

SET LOCAL app.owner_id = '80000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_pro_league_roster_version(
      '80000000-0000-4000-8000-000000000001', 'roster-v1'
    );
    RAISE EXCEPTION 'cross-owner Pro League roster was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Pro League roster was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;

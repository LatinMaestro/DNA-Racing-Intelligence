BEGIN;

SET LOCAL app.owner_id = '63000000-0000-4000-8000-000000000001';

DO $smoke$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.pro_league_aggregate_refresh_target_source(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot read aggregate refresh target source';
  END IF;
  IF has_function_privilege(
    'public',
    'dna.pro_league_aggregate_refresh_target_source(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can read aggregate refresh target source';
  END IF;

  BEGIN
    PERFORM dna.pro_league_aggregate_refresh_target_source(
      '63000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000003',
      repeat('a',64)
    );
    RAISE EXCEPTION 'missing aggregate claim was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'missing aggregate claim was accepted' THEN RAISE; END IF;
    IF position('claim is unavailable' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.pro_league_aggregate_refresh_target_source(
      '63000000-0000-4000-8000-000000000009',
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000003',
      repeat('a',64)
    );
    RAISE EXCEPTION 'cross-owner aggregate target source was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner aggregate target source was accepted' THEN RAISE; END IF;
    IF position('owner-scoped aggregate refresh target source denied' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$smoke$;

ROLLBACK;

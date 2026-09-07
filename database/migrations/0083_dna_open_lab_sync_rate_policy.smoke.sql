BEGIN;
INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('83000000-0000-4000-8000-000000000001', 'synthetic_rate_owner'),
  ('83000000-0000-4000-8000-000000000002', 'synthetic_rate_other');

DO $privileges$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.dna_open_lab_sync_rate_policy', 'SELECT')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.read_dna_open_lab_sync_rate_policy(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.set_dna_open_lab_sync_rate_policy(uuid,integer,timestamp with time zone,bigint,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.record_dna_open_lab_rate_observation(uuid,boolean,integer,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DNA Open Lab rate policy runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '83000000-0000-4000-8000-000000000001';
DO $lifecycle$
DECLARE
  v_rate integer;
  v_reason text;
  v_version bigint;
BEGIN
  SELECT effective_requests_per_minute, version INTO v_rate, v_version
  FROM dna.set_dna_open_lab_sync_rate_policy(
    '83000000-0000-4000-8000-000000000001', 150,
    '2026-09-08T10:00:00Z', 0, '2026-09-07T10:00:00Z'
  );
  IF (v_rate, v_version) <> (150, 1) THEN
    RAISE EXCEPTION 'elevated DNA Open Lab rate was not stored';
  END IF;
  SELECT effective_requests_per_minute, fallback_reason INTO v_rate, v_reason
  FROM dna.record_dna_open_lab_rate_observation(
    '83000000-0000-4000-8000-000000000001', true, 30,
    '2026-09-07T10:01:00Z'
  );
  IF (v_rate, v_reason) <> (30, 'provider_limit_reduced') THEN
    RAISE EXCEPTION 'provider reduction did not fail back to 30 rpm';
  END IF;
  SELECT effective_requests_per_minute, version INTO v_rate, v_version
  FROM dna.set_dna_open_lab_sync_rate_policy(
    '83000000-0000-4000-8000-000000000001', 150,
    '2026-09-08T10:00:00Z', 2, '2026-09-07T10:02:00Z'
  );
  SELECT effective_requests_per_minute, fallback_reason INTO v_rate, v_reason
  FROM dna.record_dna_open_lab_rate_observation(
    '83000000-0000-4000-8000-000000000001', true, NULL,
    '2026-09-07T10:03:00Z'
  );
  IF (v_rate, v_reason) <> (30, 'rate_limit_observed') THEN
    RAISE EXCEPTION 'headerless rate limit did not fail back to 30 rpm';
  END IF;
  BEGIN
    PERFORM * FROM dna.set_dna_open_lab_sync_rate_policy(
      '83000000-0000-4000-8000-000000000001', 150,
      NULL, 4, '2026-09-07T10:04:00Z'
    );
    RAISE EXCEPTION 'unbounded elevated rate was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unbounded elevated rate was accepted' THEN RAISE; END IF;
  END;
END
$lifecycle$;

SET LOCAL app.owner_id = '83000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_sync_rate_policy(
      '83000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner rate policy was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner rate policy was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;
ROLLBACK;

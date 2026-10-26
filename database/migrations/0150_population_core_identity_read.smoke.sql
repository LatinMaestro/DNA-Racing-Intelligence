BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1500000-0000-4000-8000-000000000001', 'smoke_population_identity_owner'),
  ('a1500000-0000-4000-8000-000000000002', 'smoke_population_identity_other');

INSERT INTO dna.dna_population_core_history_authority (
  owner_id, generation_id, version, evaluated_at,
  core_set_sha256, core_count, core_ids, registered_at
) VALUES
  ('a1500000-0000-4000-8000-000000000001',
   'a1500000-0000-4000-8000-000000000011', 1,
   '2026-10-01T00:00:00Z', repeat('a', 64), 1,
   jsonb_build_array(9001), '2026-10-01T00:01:00Z'),
  ('a1500000-0000-4000-8000-000000000001',
   'a1500000-0000-4000-8000-000000000012', 1,
   '2026-10-02T00:00:00Z', repeat('b', 64), 2,
   jsonb_build_array(9002, 9003), '2026-10-02T00:01:00Z');

DO $permissions$
BEGIN
  IF NOT has_function_privilege('dna_app_runtime',
      'dna.read_dna_population_core_identity(uuid,bigint)', 'EXECUTE')
     OR has_table_privilege('dna_app_runtime',
      'dna.dna_population_core_history_authority', 'SELECT') THEN
    RAISE EXCEPTION 'population Core identity read privileges are unsafe';
  END IF;
END
$permissions$;

\if :{?skip_runtime_role}
\else
SET LOCAL ROLE dna_app_runtime;
\endif
SET LOCAL app.owner_id = 'a1500000-0000-4000-8000-000000000001';

DO $read$
BEGIN
  IF (SELECT count(*) FROM dna.read_dna_population_core_identity(
      'a1500000-0000-4000-8000-000000000001', 9002)
      WHERE source_core_id = '9002'
        AND generation_id = 'a1500000-0000-4000-8000-000000000012'
        AND evaluated_at = '2026-10-02T00:00:00Z'
        AND core_set_sha256 = repeat('b', 64)
        AND core_count = 2) <> 1 THEN
    RAISE EXCEPTION 'latest population Core identity read is invalid';
  END IF;
  IF EXISTS (SELECT * FROM dna.read_dna_population_core_identity(
      'a1500000-0000-4000-8000-000000000001', 9001)) THEN
    RAISE EXCEPTION 'older population Core identity leaked into latest authority';
  END IF;
  BEGIN
    PERFORM dna.read_dna_population_core_identity(
      'a1500000-0000-4000-8000-000000000002', 9002);
    RAISE EXCEPTION 'cross-owner population Core identity read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-owner population Core identity read accepted' THEN RAISE; END IF;
  END;
END
$read$;

\if :{?skip_runtime_role}
\else
RESET ROLE;
\endif
ROLLBACK;
